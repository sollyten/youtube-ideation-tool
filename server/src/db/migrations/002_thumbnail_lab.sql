-- Thumbnail Lab — ISOLATED module storage.
--
-- Deliberately decoupled from profiles: keyed by (owner_user_id, slug) as a
-- plain string, with NO foreign key to profiles. The only channel data that
-- lives here is visual. Nothing in these tables references strategy, memory,
-- audience, or the profile. See thumbnail-lab/README.md for the contract.

CREATE TABLE thumbnail_styles (
  owner_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug           TEXT NOT NULL,
  descriptor     JSONB NOT NULL DEFAULT '{}',   -- visual_style (schema in thumbnail-lab/)
  negative_style JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, slug)
);

CREATE TABLE thumbnail_references (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  filename      TEXT NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  media_type    TEXT NOT NULL,
  data          BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thumbnail_references_owner_slug_idx ON thumbnail_references(owner_user_id, slug);

CREATE TABLE thumbnail_generations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  request       TEXT NOT NULL,
  prompt_used   TEXT NOT NULL,
  style_locked  TEXT NOT NULL DEFAULT '',
  result        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX thumbnail_generations_owner_slug_idx ON thumbnail_generations(owner_user_id, slug, created_at DESC);
