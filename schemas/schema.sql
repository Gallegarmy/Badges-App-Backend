\c badges;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  is_permanent BOOLEAN NOT NULL
);

CREATE TABLE user_badges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id),
  badge_id UUID REFERENCES badges(id),
  obtained_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP
);

CREATE TABLE qr_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  badge_id UUID REFERENCES badges(id),
  expires_at TIMESTAMP NOT NULL
);

-- Ownership
ALTER TABLE users OWNER TO badges_user;
ALTER TABLE badges OWNER TO badges_user;
ALTER TABLE user_badges OWNER TO badges_user;
ALTER TABLE qr_codes OWNER TO badges_user;

-- Privileges
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO badges_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO badges_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON TABLES TO badges_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT ALL PRIVILEGES ON SEQUENCES TO badges_user;
