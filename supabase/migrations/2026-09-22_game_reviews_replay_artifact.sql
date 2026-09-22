-- F1e-5 (docs/scoping/game-review-explanation-overhaul-2026-09-19.md):
-- versioned historical Game Review replay artifact.
--
-- ADDITIVE ONLY. Nullable column so existing rows remain readable.
-- Do NOT execute against production from an agent session — owner applies
-- this migration in normal deploy order (schema before app that writes the
-- new field). New app versions must treat NULL as legacy (no Fritz recompute).
--
-- Artifact shape is versioned inside the jsonb (`artifactVersion`), not by
-- renaming columns. Server validates version on write/read boundaries.

alter table public.game_reviews
  add column if not exists replay_artifact jsonb null;

comment on column public.game_reviews.replay_artifact is
  'F1e-5 versioned historical replay payload (canonical coaching facts/prose + navigation). NULL = legacy row predating replayable explanations.';
