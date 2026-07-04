-- Multi-user core schema. Every domain table is scoped by owner_user_id and
-- all access goes through the user-scoped data layer (src/data/scoped.ts).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('director', 'admin')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Server-side sessions. The cookie carries a random token; we store its SHA-256
-- so a database leak does not yield usable session tokens.
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- Channel profiles. The JSON shape of `data` follows profiles/_SCHEMA.json;
-- owner/visibility/slug are first-class columns because access control and
-- uniqueness depend on them. slug is unique PER USER, not globally.
CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'company')),
  data          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, slug)
);
CREATE INDEX profiles_owner_idx ON profiles(owner_user_id);
CREATE INDEX profiles_visibility_idx ON profiles(visibility) WHERE visibility = 'company';

-- The no-repeat idea store (memory/<slug>_ideas.jsonl in the single-user tool).
-- One row per selected idea; both ideation prompts receive the full set.
CREATE TABLE idea_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  idea          JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idea_memory_profile_idx ON idea_memory(owner_user_id, profile_id);

-- Saved run reports (ideas | competitor | retention | performance).
-- The History tab queries this, always filtered to the current user.
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('ideas', 'competitor', 'retention', 'performance')),
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reports_owner_idx ON reports(owner_user_id, created_at DESC);
CREATE INDEX reports_profile_idx ON reports(owner_user_id, profile_id, type);

-- Per-user, per-profile YouTube OAuth tokens, ENCRYPTED AT REST (AES-256-GCM
-- via TOKEN_ENCRYPTION_KEY). Decrypted only server-side at call time. A
-- director can only ever reach tokens for channels they personally connected —
-- these are NEVER shared through 'company' visibility.
CREATE TABLE channel_tokens (
  owner_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  encrypted_token TEXT NOT NULL,
  connected_channel_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, profile_id)
);

-- Usage/cost tracking: one row per expensive action. Feeds per-user quotas and
-- the admin usage view (all spend bills to the company).
CREATE TABLE usage_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  profile_id    UUID,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_user_action_idx ON usage_events(owner_user_id, action, created_at);
