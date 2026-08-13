-- Composite index for the "find active match for user in room" hot path.
--
-- The Fritz disconnect handler and ghost route both query:
--   bot_match_pending WHERE room_code = ? AND user_id = ? AND resolved = false
--
-- Existing indexes:
--   bot_match_pending_room_code_resolved_idx  (room_code, resolved)
--   bot_match_pending_user_id_resolved_idx    (user_id, resolved)
--
-- Neither covers the three-column equality filter in one scan.
-- This composite index lets Postgres satisfy the query with a single index
-- range scan on (user_id, room_code) filtered to resolved = false.

create index if not exists bot_match_pending_user_room_active_idx
  on public.bot_match_pending (user_id, room_code, resolved)
  where resolved = false;
