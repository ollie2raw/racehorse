-- player_presence: tracks real-time user status.
-- Written exclusively by the server service role via socket events.
-- Run this in the Supabase SQL Editor before deploying the social system.

CREATE TABLE IF NOT EXISTS player_presence (
  user_id      UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL
                 CHECK (status IN ('online', 'in_game', 'offline'))
                 DEFAULT 'offline',
  current_mode TEXT,
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_presence ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read any presence row (for friend list display).
CREATE POLICY "authenticated read presence"
  ON player_presence FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can upsert their own row as a fallback.
CREATE POLICY "own presence insert"
  ON player_presence FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own presence update"
  ON player_presence FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

-- NOTE: service_role bypasses RLS by default; no explicit service_role policy needed.
