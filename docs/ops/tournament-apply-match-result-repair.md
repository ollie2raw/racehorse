# Ops: repair a stuck tournament match after applyMatchResult give-up

**When (game-over path):** Players saw game-over (and may have toasted *tournament result couldn't be saved*), but the bracket never advanced. Funnel: `private_game_over_persist_failed` with `extra.kind = "tournament_apply"`.

**When (forfeit path, G2):** A player left/forfeited, seats may have seen *Forfeit recorded, but the tournament result couldn't be saved…*, and the live room has `tournamentForfeitApplyStatus = 'failed'` with **`abandonedAt` still unset**. Funnel: same event with `extra.kind = "tournament_forfeit_apply"`. The bracket did **not** advance; do not treat the room as successfully abandoned.

**Player refresh does not fix this.** Persist is latched `failed` in that room process; repair is ops-side.

## Confirm stuck

```sql
-- Match should still be open if apply never stuck:
select id, tournament_id, round, match_number, status, room_code,
       player1_id, player2_id, winner_id, player1_score, player2_score
from public.scheduled_tournament_matches
where id = '<matchId>';   -- from toast / funnel / room.scheduledTournamentMatchId
-- Stuck: status in ('ready','in_progress') AND winner_id is null
-- Already fixed: status = 'completed' AND winner_id set → stop (apply is idempotent)
```

Winner/loser user ids are `player1_id` / `player2_id` on that row. Scores: use the finished room scores if you still have them; otherwise reconstruct from player report + server logs. For a forfeit give-up, winner is the non-forfeiting seat; `winnerSource` on repair should be `'forfeit'`.

## Safe fix (preferred): re-run `applyMatchResult`

Do **not** hand-edit only `winner_id`. Advancement (next-round slot, loser `eliminated`, final → `completeTournament`) lives in `applyMatchResult` (`server/src/scheduledTournament/engine.ts`). That function **no-ops if `status === 'completed'`**, so a second call is safe.

From a one-off server context that has Socket.IO + DB (same process as production, or a small script importing the engine):

```ts
await applyMatchResult(io, {
  matchId: '<matchId>',
  winnerId: '<winner auth user uuid>',
  player1Score: <number>,  // seat/player1 score on the match row orientation
  player2Score: <number>,
  winnerSource: 'game_over', // or 'forfeit' when repairing a forfeit give-up
  // optional for forfeit repair:
  // statusReason: 'player1_forfeit' | 'player2_forfeit',
  // forfeitUserId: '<loser auth user uuid>',
});
```

That will: mark the match completed, eliminate the loser registration, emit `tournament:match_completed`, fill the next-round slot (`waiting`/`ready`), and if final, complete the tournament.

After a forfeit-path repair, the in-memory room (if still alive) may still show `tournamentForfeitApplyStatus = 'failed'` until process/room cleanup — bracket truth is the DB row + engine emissions.

## SQL-only (last resort)

Only if you cannot run the engine. You must do **all** of:

1. Complete the stuck row (`status`, `winner_id`, scores, `completed_at`, `winner_source`).
2. Set loser registration to `eliminated` on `scheduled_tournament_registrations` (skip bot ids).
3. Write the winner into the correct next-round slot (`player1_id` / `player2_id` via `advanceSlot` in `bracket.ts`) and set that match to `waiting` or `ready`.
4. If round 3 (final): set `scheduled_tournaments.status = 'completed'` and `winner_id`.

Getting slot mapping wrong bricks the bracket worse than leaving it stuck — prefer the code path.

## After repair

Ask affected players to refresh the bracket (or wait for `tournament:match_updated` / `match_completed` if the live server emitted them). Next-round `ready` matches still need normal attach/dispatch if players are waiting.
