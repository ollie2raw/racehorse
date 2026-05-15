-- rivals: caches auto-assigned rival relationships computed from match history.
-- Written by the server service role when getAutoRivals() is called.
-- The rivals table is a materialized cache; the source of truth remains the matches table.
-- Run this in the Supabase SQL Editor before deploying the social system.

CREATE TABLE IF NOT EXISTS rivals (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rival_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  h2h_record JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, rival_id)
);

CREATE INDEX IF NOT EXISTS idx_rivals_user_id ON rivals (user_id);

ALTER TABLE rivals ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read their own rivals and rivals of friends.
CREATE POLICY "authenticated read own rivals"
  ON rivals FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM friends
       WHERE status = 'accepted'
         AND (
           (friends.user_id = auth.uid() AND friends.friend_user_id = rivals.user_id)
           OR
           (friends.friend_user_id = auth.uid() AND friends.user_id = rivals.user_id)
         )
    )
  );

-- Users can manage their own rivals (needed for client-chosen rivals in future).
CREATE POLICY "own rivals insert"
  ON rivals FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "own rivals update"
  ON rivals FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "own rivals delete"
  ON rivals FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- NOTE: service_role bypasses RLS by default; server upserts work without an explicit policy.
