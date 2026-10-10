-- Daily recharge: once per day (India time) a player can claim free VIRTUAL points (no payment, no cash value).

ALTER TABLE virtual_wallet_transactions DROP CONSTRAINT virtual_wallet_transactions_type_check;
ALTER TABLE virtual_wallet_transactions ADD CONSTRAINT virtual_wallet_transactions_type_check
  CHECK (type IN ('signup_bonus', 'bet_debit', 'bet_payout', 'bet_refund', 'referral_bonus', 'daily_recharge'));
-- one claim per player per IST calendar day
CREATE UNIQUE INDEX vwt_daily_recharge_uq ON virtual_wallet_transactions (user_id, ((created_at AT TIME ZONE 'Asia/Kolkata')::date))
  WHERE type = 'daily_recharge';
