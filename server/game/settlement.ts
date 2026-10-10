import { payoutFor, type Game, type Selection } from "../../shared/game";
import { withTransaction } from "../db/pool";
import { audit } from "../lib/audit";
import { resultFromSeed } from "../lib/rng";
import type { RoundRow } from "./rounds";

export interface SettlementOutcome {
  roundId: number;
  game: Game;
  code: string;
  number: number;
  price: number;
  serverSeed: string;
  settledAt: number;
  winners: number;
  losers: number;
  totalPaid: number;
}

/**
 * Settles a round exactly once. The result is derived only from the seed that was
 * committed when the round was created. Wallet credits and the ledger are written
 * in the same transaction as the result, so accounting can never be half-applied.
 */
export async function settleRound(roundId: number): Promise<SettlementOutcome | null> {
  return withTransaction(async (db) => {
    const { rows } = await db.query<RoundRow>("SELECT * FROM game_rounds WHERE id = $1 FOR UPDATE", [roundId]);
    const round = rows[0];
    if (!round || round.status === "settled") return null;

    const draw = resultFromSeed(round.server_seed, round.game, round.code);
    const { rows: res } = await db.query<{ created_at: Date }>(
      "INSERT INTO game_results (round_id, number, price, server_seed) VALUES ($1, $2, $3, $4) RETURNING created_at",
      [round.id, draw.number, draw.price, round.server_seed],
    );

    // Work out every pending bet's payout from the result number, then apply in one statement.
    const { rows: pending } = await db.query<{ id: number; selection: Selection; amount: number }>(
      "SELECT id, selection, amount FROM bets WHERE round_id = $1 AND status = 'pending' FOR UPDATE",
      [round.id],
    );
    const ids = pending.map((b) => b.id);
    const payouts = pending.map((b) => payoutFor(b.selection, b.amount, draw.number));
    if (pending.length) {
      await db.query(
        `UPDATE bets b SET status = CASE WHEN v.payout > 0 THEN 'won' ELSE 'lost' END, payout = v.payout, settled_at = now()
           FROM unnest($1::bigint[], $2::int[]) AS v(id, payout) WHERE b.id = v.id`,
        [ids, payouts],
      );
    }

    // Credit winners and write one ledger entry per winning bet (one bet per user per round).
    const { rows: paid } = await db.query<{ total: number | null }>(
      `WITH credited AS (
         UPDATE virtual_wallets v SET balance = v.balance + b.payout, updated_at = now()
           FROM bets b
          WHERE b.round_id = $1 AND b.status = 'won' AND b.payout > 0 AND v.user_id = b.user_id
         RETURNING v.user_id, v.balance, b.id AS bet_id, b.payout
       ), ledger AS (
         INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, bet_id, round_id, description)
         SELECT user_id, 'bet_payout', payout, balance, bet_id, $1, $2 FROM credited
         RETURNING amount
       )
       SELECT SUM(amount)::bigint AS total FROM ledger`,
      [round.id, `Win - ${round.game} ${round.code} (result ${draw.number})`],
    );

    await db.query(
      "UPDATE game_rounds SET status = 'settled', closed_at = COALESCE(closed_at, now()), settled_at = now() WHERE id = $1",
      [round.id],
    );

    const winners = payouts.filter((p) => p > 0).length;
    const outcome: SettlementOutcome = {
      roundId: round.id,
      game: round.game,
      code: round.code,
      number: draw.number,
      price: draw.price,
      serverSeed: round.server_seed,
      settledAt: res[0].created_at.getTime(),
      winners,
      losers: pending.length - winners,
      totalPaid: paid[0]?.total ?? 0,
    };
    await audit(db, {
      actor: "system",
      action: "round_settled",
      targetType: "round",
      targetId: `${round.game}:${round.code}`,
      details: {
        number: draw.number,
        commitHash: round.server_seed_hash,
        winners: outcome.winners,
        losers: outcome.losers,
        totalPaid: outcome.totalPaid,
      },
    });
    return outcome;
  });
}
