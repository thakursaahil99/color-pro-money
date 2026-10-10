-- Free "recharge" requests: a player asks for virtual points, an admin approves or rejects.
-- There is NO payment of any kind (no UPI, no transaction ids, no money). Points have no cash value.

CREATE TABLE points_requests (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reject_reason TEXT,
  decided_by    BIGINT REFERENCES users (id) ON DELETE RESTRICT,
  decided_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT points_requests_decision CHECK (
    (status = 'pending' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
  ),
  CONSTRAINT points_requests_reason CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
-- a player can only have one open request at a time
CREATE UNIQUE INDEX points_requests_one_pending ON points_requests (user_id) WHERE status = 'pending';
CREATE INDEX points_requests_status_idx ON points_requests (status, created_at DESC);
CREATE INDEX points_requests_user_idx ON points_requests (user_id, created_at DESC);

-- A decided request is final; requests are never deleted.
CREATE FUNCTION protect_points_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deleting recharge requests is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'a decided recharge request is final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.amount <> OLD.amount OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'recharge request details are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER points_requests_protect BEFORE UPDATE OR DELETE ON points_requests
  FOR EACH ROW EXECUTE FUNCTION protect_points_request();

-- Ledger: an approved request credits the wallet exactly once.
ALTER TABLE virtual_wallet_transactions ADD COLUMN request_id BIGINT REFERENCES points_requests (id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX vwt_request_uq ON virtual_wallet_transactions (request_id) WHERE request_id IS NOT NULL;
ALTER TABLE virtual_wallet_transactions DROP CONSTRAINT virtual_wallet_transactions_type_check;
ALTER TABLE virtual_wallet_transactions ADD CONSTRAINT virtual_wallet_transactions_type_check
  CHECK (type IN ('signup_bonus', 'bet_debit', 'bet_payout', 'bet_refund', 'referral_bonus', 'daily_recharge', 'recharge_approved'));
