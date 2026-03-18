-- Single conference/event migration on top of the base badges model.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Conference entities
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  starts_at TIMESTAMP NOT NULL DEFAULT now(),
  ends_at TIMESTAMP NOT NULL DEFAULT (now() + interval '30 days'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT events_valid_date_range CHECK (starts_at <= ends_at)
);

-- Backfill/compatibility columns for environments where events existed earlier.
ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS starts_at TIMESTAMP NOT NULL DEFAULT now();
ALTER TABLE events ADD COLUMN IF NOT EXISTS ends_at TIMESTAMP NOT NULL DEFAULT (now() + interval '30 days');
ALTER TABLE events ADD COLUMN IF NOT EXISTS zero_weight_full_completion_single_entry BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS stands (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  entries_weight INTEGER NOT NULL DEFAULT 1,
  badge_id UUID REFERENCES badges(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT now(),
  CONSTRAINT stands_event_code_unique UNIQUE(event_id, code),
  CONSTRAINT stands_id_event_unique UNIQUE(id, event_id),
  CONSTRAINT stands_entries_weight_nonnegative CHECK (entries_weight >= 0)
);

-- Backfill/compatibility column for environments where stands existed earlier.
ALTER TABLE stands
  ADD COLUMN IF NOT EXISTS badge_id UUID REFERENCES badges(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS stand_qr_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  stand_id UUID NOT NULL REFERENCES stands(id) ON DELETE CASCADE,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_stand_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  stand_id UUID NOT NULL,
  scanned_at TIMESTAMP DEFAULT now(),
  CONSTRAINT user_stand_visits_user_event_stand_unique UNIQUE(user_id, event_id, stand_id),
  CONSTRAINT user_stand_visits_stand_event_fk
    FOREIGN KEY (stand_id, event_id)
    REFERENCES stands(id, event_id)
    ON DELETE CASCADE
);

-- User-to-event membership (opt-in and event-scoped roles)
CREATE TABLE IF NOT EXISTS conference_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('conference_admin', 'stand_staff')),
  stand_id UUID,
  created_at TIMESTAMP DEFAULT now()
);

ALTER TABLE user_stand_visits
  DROP CONSTRAINT IF EXISTS user_stand_visits_stand_id_fkey;

ALTER TABLE conference_memberships
  DROP CONSTRAINT IF EXISTS conference_memberships_stand_id_fkey;

ALTER TABLE conference_memberships
  DROP CONSTRAINT IF EXISTS conference_memberships_user_id_event_id_key;

-- Recreate role consistency check to ensure valid role/stand combinations.
ALTER TABLE conference_memberships
  DROP CONSTRAINT IF EXISTS conference_memberships_role_stand_check;

ALTER TABLE conference_memberships
  ADD CONSTRAINT conference_memberships_role_stand_check
  CHECK (
    (role = 'conference_admin' AND stand_id IS NULL)
    OR
    (role = 'stand_staff' AND stand_id IS NOT NULL)
  );

-- Ensure critical constraints exist for partially-migrated environments.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'events_valid_date_range'
      AND conrelid = 'events'::regclass
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_valid_date_range
      CHECK (starts_at <= ends_at);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stands_id_event_unique'
      AND conrelid = 'stands'::regclass
  ) THEN
    ALTER TABLE stands
      ADD CONSTRAINT stands_id_event_unique
      UNIQUE (id, event_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stands_entries_weight_nonnegative'
      AND conrelid = 'stands'::regclass
  ) THEN
    ALTER TABLE stands
      ADD CONSTRAINT stands_entries_weight_nonnegative
      CHECK (entries_weight >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_stand_visits_stand_event_fk'
      AND conrelid = 'user_stand_visits'::regclass
  ) THEN
    ALTER TABLE user_stand_visits
      ADD CONSTRAINT user_stand_visits_stand_event_fk
      FOREIGN KEY (stand_id, event_id)
      REFERENCES stands(id, event_id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conference_memberships_stand_event_fk'
      AND conrelid = 'conference_memberships'::regclass
  ) THEN
    ALTER TABLE conference_memberships
      ADD CONSTRAINT conference_memberships_stand_event_fk
      FOREIGN KEY (stand_id, event_id)
      REFERENCES stands(id, event_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Ownership and grants
-- ---------------------------------------------------------------------------
ALTER TABLE IF EXISTS events OWNER TO badges_user;
ALTER TABLE IF EXISTS stands OWNER TO badges_user;
ALTER TABLE IF EXISTS stand_qr_codes OWNER TO badges_user;
ALTER TABLE IF EXISTS user_stand_visits OWNER TO badges_user;
ALTER TABLE IF EXISTS conference_memberships OWNER TO badges_user;

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO badges_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO badges_user;

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS events_is_active_idx ON events(is_active);
CREATE INDEX IF NOT EXISTS events_starts_ends_idx ON events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS stands_event_id_idx ON stands(event_id);
CREATE INDEX IF NOT EXISTS stands_badge_id_idx ON stands(badge_id);
CREATE UNIQUE INDEX IF NOT EXISTS stands_event_badge_unique_idx
  ON stands(event_id, badge_id)
  WHERE badge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stand_qr_codes_stand_id_idx ON stand_qr_codes(stand_id);
CREATE INDEX IF NOT EXISTS user_stand_visits_user_event_idx ON user_stand_visits(user_id, event_id);
CREATE INDEX IF NOT EXISTS conference_memberships_event_role_idx ON conference_memberships(event_id, role);
DROP INDEX IF EXISTS conference_memberships_user_event_idx;
CREATE UNIQUE INDEX IF NOT EXISTS conference_memberships_admin_unique_idx
  ON conference_memberships(user_id, event_id)
  WHERE role = 'conference_admin';
CREATE UNIQUE INDEX IF NOT EXISTS conference_memberships_staff_unique_idx
  ON conference_memberships(user_id, event_id, stand_id)
  WHERE role = 'stand_staff';
