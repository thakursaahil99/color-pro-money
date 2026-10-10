-- Referrals: every player gets a code; when someone registers with it, the referrer receives
-- a bonus in VIRTUAL points (no cash value).

ALTER TABLE users ADD COLUMN referral_code TEXT;
UPDATE users SET referral_code = upper(substr(md5(random()::text || id::text), 1, 8));
ALTER TABLE users ALTER COLUMN referral_code SET DEFAULT upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
ALTER TABLE users ALTER COLUMN referral_code SET NOT NULL;
CREATE UNIQUE INDEX users_referral_code_uq ON users (referral_code);

CREATE TABLE referrals (
  id          BIGSERIAL PRIMARY KEY,
  referrer_id BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- a person can only ever be referred once
  referred_id BIGINT NOT NULL UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  bonus       INTEGER NOT NULL CHECK (bonus >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT referrals_not_self CHECK (referrer_id <> referred_id)
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id, created_at DESC);
CREATE TRIGGER referrals_immutable BEFORE UPDATE OR DELETE ON referrals
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE virtual_wallet_transactions DROP CONSTRAINT virtual_wallet_transactions_type_check;
ALTER TABLE virtual_wallet_transactions ADD CONSTRAINT virtual_wallet_transactions_type_check
  CHECK (type IN ('signup_bonus', 'bet_debit', 'bet_payout', 'bet_refund', 'referral_bonus'));
