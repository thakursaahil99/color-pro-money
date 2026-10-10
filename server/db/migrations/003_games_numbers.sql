-- Four parallel games (Parity, Sapre, Bcone, Emerd), number results 0-9, and bets on a colour or a number.

-- ------------------------------------------------------------ game_rounds
ALTER TABLE game_rounds ADD COLUMN game TEXT NOT NULL DEFAULT 'parity';
ALTER TABLE game_rounds ALTER COLUMN game DROP DEFAULT;
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_game_check CHECK (game IN ('parity', 'sapre', 'bcone', 'emerd'));
ALTER TABLE game_rounds DROP CONSTRAINT game_rounds_slot_key;
ALTER TABLE game_rounds DROP CONSTRAINT game_rounds_code_key;
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_game_slot_uq UNIQUE (game, slot);
ALTER TABLE game_rounds ADD CONSTRAINT game_rounds_game_code_uq UNIQUE (game, code);
CREATE INDEX game_rounds_game_starts_idx ON game_rounds (game, starts_at DESC);

CREATE OR REPLACE FUNCTION protect_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deleting rounds is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.server_seed IS DISTINCT FROM OLD.server_seed
     OR NEW.server_seed_hash IS DISTINCT FROM OLD.server_seed_hash
     OR NEW.game IS DISTINCT FROM OLD.game
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

-- ----------------------------------------------------------- game_results
-- Results from the earlier 3-colour version are converted (green=1, red=2, violet=0) so history is kept.
ALTER TABLE game_results DISABLE TRIGGER game_results_immutable;
ALTER TABLE game_results ADD COLUMN number SMALLINT;
ALTER TABLE game_results ADD COLUMN price INTEGER;
UPDATE game_results SET number = CASE color WHEN 'green' THEN 1 WHEN 'red' THEN 2 ELSE 0 END;
UPDATE game_results SET price = (1000 + (round_id * 37) % 9000) * 10 + number;
ALTER TABLE game_results ALTER COLUMN number SET NOT NULL;
ALTER TABLE game_results ALTER COLUMN price SET NOT NULL;
ALTER TABLE game_results ADD CONSTRAINT game_results_number_check CHECK (number BETWEEN 0 AND 9);
ALTER TABLE game_results DROP COLUMN color;
ALTER TABLE game_results ENABLE TRIGGER game_results_immutable;

-- ------------------------------------------------------------------- bets
ALTER TABLE bets RENAME COLUMN color TO selection;
ALTER TABLE bets DROP CONSTRAINT bets_color_check;
ALTER TABLE bets ADD CONSTRAINT bets_selection_check
  CHECK (selection IN ('green', 'violet', 'red', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'));
ALTER INDEX bets_round_color_idx RENAME TO bets_round_selection_idx;

CREATE OR REPLACE FUNCTION protect_bet() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deleting bets is not allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'settled bets are final' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.round_id <> OLD.round_id OR NEW.selection <> OLD.selection
     OR NEW.amount <> OLD.amount OR NEW.client_nonce <> OLD.client_nonce OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'bet details are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
