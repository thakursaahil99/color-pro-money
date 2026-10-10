-- ColorProMoney initial schema. All balances are VIRTUAL POINTS with no cash value.

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT NOT NULL,
  email              TEXT NOT NULL,
  password_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  suspended_reason   TEXT,
  suspended_at       TIMESTAMPTZ,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  last_login_at      TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  is_demo            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username ~ '^[A-Za-z0-9_]{3,24}$'),
  CONSTRAINT users_suspension_reason CHECK (status <> 'suspended' OR suspended_reason IS NOT NULL)
);
CREATE UNIQUE INDEX users_username_lower_uq ON users (lower(username));
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE INDEX users_last_seen_idx ON users (last_seen_at DESC);
CREATE INDEX users_status_idx ON users (status);

-- ------------------------------------------------------------- sessions
-- Only a SHA-256 hash of the session token is stored; the raw token lives in an httpOnly cookie.
CREATE TABLE sessions (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ------------------------------------------------------ virtual wallets
CREATE TABLE virtual_wallets (
  user_id    BIGINT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  balance    BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------- game rounds
-- server_seed is secret until the round settles; server_seed_hash is published up front
-- (commit-reveal) so players can verify that the result was fixed before betting closed.
CREATE TABLE game_rounds (
  id                BIGSERIAL PRIMARY KEY,
  slot              BIGINT NOT NULL UNIQUE,
  code              TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'settled')),
  starts_at         TIMESTAMPTZ NOT NULL,
  betting_closes_at TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  server_seed       TEXT NOT NULL,
  server_seed_hash  TEXT NOT NULL,
  closed_at         TIMESTAMPTZ,
  settled_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT game_rounds_window CHECK (starts_at < betting_closes_at AND betting_closes_at < ends_at)
);
CREATE INDEX game_rounds_status_idx ON game_rounds (status);
CREATE INDEX game_rounds_starts_idx ON game_rounds (starts_at DESC);

-- ---------------------------------------------------------- game results
CREATE TABLE game_results (
  id          BIGSERIAL PRIMARY KEY,
  round_id    BIGINT NOT NULL UNIQUE REFERENCES game_rounds (id) ON DELETE RESTRICT,
  color       TEXT NOT NULL CHECK (color IN ('red', 'green', 'violet')),
  server_seed TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX game_results_created_idx ON game_results (created_at DESC);

-- ------------------------------------------------------------------ bets
CREATE TABLE bets (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  round_id     BIGINT NOT NULL REFERENCES game_rounds (id) ON DELETE RESTRICT,
  color        TEXT NOT NULL CHECK (color IN ('red', 'green', 'violet')),
  amount       INTEGER NOT NULL CHECK (amount IN (10, 50, 100, 500, 1000)),
  client_nonce UUID NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'refunded')),
  payout       INTEGER NOT NULL DEFAULT 0 CHECK (payout >= 0),
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at   TIMESTAMPTZ,
  -- one bet per player per round (prevents duplicate bets)
  CONSTRAINT bets_one_per_round UNIQUE (user_id, round_id),
  -- each client nonce can only ever be used once (prevents replayed requests)
  CONSTRAINT bets_nonce_uq UNIQUE (user_id, client_nonce)
);
CREATE INDEX bets_round_idx ON bets (round_id);
CREATE INDEX bets_user_created_idx ON bets (user_id, created_at DESC);
CREATE INDEX bets_round_color_idx ON bets (round_id, color);
CREATE INDEX bets_created_idx ON bets (created_at DESC);

-- --------------------------------------------- virtual wallet transactions
CREATE TABLE virtual_wallet_transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  type          TEXT NOT NULL CHECK (type IN ('signup_bonus', 'bet_debit', 'bet_payout', 'bet_refund')),
  amount        BIGINT NOT NULL CHECK (amount <> 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  bet_id        BIGINT REFERENCES bets (id) ON DELETE RESTRICT,
  round_id      BIGINT REFERENCES game_rounds (id) ON DELETE RESTRICT,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- a bet can be debited once and paid/refunded once: no double accounting
CREATE UNIQUE INDEX vwt_bet_type_uq ON virtual_wallet_transactions (bet_id, type) WHERE bet_id IS NOT NULL;
CREATE UNIQUE INDEX vwt_signup_uq ON virtual_wallet_transactions (user_id) WHERE type = 'signup_bonus';
CREATE INDEX vwt_user_created_idx ON virtual_wallet_transactions (user_id, created_at DESC);

-- ------------------------------------------------------ admin audit logs
-- actor = 'admin' (a logged-in admin), 'system' (game engine) or 'cli' (setup scripts).
-- Rows form a SHA-256 hash chain so any tampering at the database level is detectable.
CREATE TABLE admin_audit_logs (
  id            BIGSERIAL PRIMARY KEY,
  actor         TEXT NOT NULL CHECK (actor IN ('admin', 'system', 'cli')),
  admin_user_id BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  prev_hash     TEXT NOT NULL DEFAULT '',
  entry_hash    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_admin_actor CHECK (actor <> 'admin' OR admin_user_id IS NOT NULL)
);
CREATE INDEX audit_created_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX audit_admin_idx ON admin_audit_logs (admin_user_id);
CREATE INDEX audit_target_idx ON admin_audit_logs (target_type, target_id);

-- ------------------------------------------------------- security events
-- Signals used by the admin "suspicious activity" review (failed logins, late/duplicate bets, rate limits).
CREATE TABLE security_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT REFERENCES users (id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  details    JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip         TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_idx ON security_events (user_id, created_at DESC);
CREATE INDEX security_events_created_idx ON security_events (created_at DESC);

-- ------------------------------------------------------- system settings
CREATE TABLE system_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by BIGINT REFERENCES users (id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO system_settings (key, value) VALUES ('rounds_paused', 'false'::jsonb);

-- ============================================================ integrity triggers

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on table % is not allowed (append-only)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Results, ledger entries and audit logs are append-only.
CREATE TRIGGER game_results_immutable BEFORE UPDATE OR DELETE ON game_results
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER vwt_immutable BEFORE UPDATE OR DELETE ON virtual_wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_no_truncate BEFORE TRUNCATE ON admin_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER results_no_truncate BEFORE TRUNCATE ON game_results
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- A round's seed, schedule and identity can never change after creation,
-- and a settled round can never be re-opened.
CREATE FUNCTION protect_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deleting rounds is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.server_seed IS DISTINCT FROM OLD.server_seed
     OR NEW.server_seed_hash IS DISTINCT FROM OLD.server_seed_hash
     OR NEW.slot IS DISTINCT FROM OLD.slot
     OR NEW.code IS DISTINCT FROM OLD.code
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.betting_closes_at IS DISTINCT FROM OLD.betting_closes_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
    RAISE EXCEPTION 'round identity, schedule and seed are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'settled' AND NEW.status <> 'settled' THEN
    RAISE EXCEPTION 'settled rounds cannot be re-opened' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'closed' AND NEW.status = 'open' THEN
    RAISE EXCEPTION 'closed rounds cannot be re-opened' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER game_rounds_protect BEFORE UPDATE OR DELETE ON game_rounds
  FOR EACH ROW EXECUTE FUNCTION protect_round();

-- Settled bets are final.
CREATE FUNCTION protect_bet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deleting bets is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'settled bets are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.round_id <> OLD.round_id OR NEW.color <> OLD.color
     OR NEW.amount <> OLD.amount OR NEW.client_nonce <> OLD.client_nonce OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'bet details are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bets_protect BEFORE UPDATE OR DELETE ON bets
  FOR EACH ROW EXECUTE FUNCTION protect_bet();

-- Audit hash chain: entry_hash = sha256(prev_hash | row contents).
CREATE FUNCTION audit_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  last_hash TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(727274);
  SELECT entry_hash INTO last_hash FROM admin_audit_logs ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := COALESCE(last_hash, '');
  NEW.entry_hash := encode(sha256(convert_to(
    NEW.prev_hash || '|' || NEW.actor || '|' || COALESCE(NEW.admin_user_id::text, '') || '|' ||
    NEW.action || '|' || COALESCE(NEW.target_type, '') || '|' || COALESCE(NEW.target_id, '') || '|' ||
    NEW.details::text || '|' || to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    'UTF8')), 'hex');
  RETURN NEW;
END;
$$;
CREATE TRIGGER audit_chain_before_insert BEFORE INSERT ON admin_audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_chain();
