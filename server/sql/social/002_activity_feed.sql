-- activity_feed: immutable event log for the social activity feed.
-- Written exclusively by server endpoints/socket handlers using the service key.
-- Run this in the Supabase SQL Editor before deploying the social system.

CREATE TABLE IF NOT EXISTS activity_feed (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       TEXT        NOT NULL
               CHECK (type IN ('win','loss','streak','tournament','puzzle','daily_fritz')),
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_user_created
  ON activity_feed (user_id, created_at DESC);

ALTER TABLE activity_feed ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all activity (needed for cross-friend feed queries).
CREATE POLICY "authenticated read activity"
  ON activity_feed FOR SELECT
  TO authenticated
  USING (true);

-- NOTE: service_role bypasses RLS by default; no INSERT policy needed for
-- authenticated users because clients never write activity rows directly.
