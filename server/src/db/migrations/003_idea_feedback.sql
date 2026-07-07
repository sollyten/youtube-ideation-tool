-- Director feedback on idea runs (the post-ideation "pick the best ones" query).
-- One row per (user, report). Both the picks and the passes are stored — the
-- negative signal is as useful as the positive one when steering future runs.
-- This is per-profile training data: services/ideaScoring.ts injects the recent
-- rows into prompts 01/02 so generation and scoring learn the director's taste.

CREATE TABLE idea_feedback (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  report_id     UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  selected      JSONB NOT NULL,               -- [{title, premise}] the director picked
  passed        JSONB NOT NULL,               -- [title, ...] shown but not picked
  comments      TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, report_id)
);
CREATE INDEX idea_feedback_profile_idx ON idea_feedback(owner_user_id, profile_id, created_at DESC);
