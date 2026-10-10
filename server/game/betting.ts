import { isBetAmount, isSelection, type Selection } from "../../shared/game";
import { withTransaction } from "../db/pool";
import { HttpError, badRequest, conflict } from "../lib/errors";
import { recordSecurityEvent } from "../lib/security";
import type { RoundRow } from "./rounds";

export interface PlaceBetInput {
  userId: number;
  roundId: number;
  selection: Selection;
  amount: number;
  nonce: string;
  ip?: string | null;
  nowMs: number;
}

export interface PlacedBet {
  bet: {
    id: number;
    roundId: number;
    game: string;
    roundCode: string;
    selection: Selection;
    amount: number;
    status: string;
    payout: number;
    createdAt: string;
  };
  balance: number;
}

/**
 * Places a bet atomically. All checks use server state only: the client's clock,
 * balance and round status are never trusted.
 */
export async function placeBet(input: PlaceBetInput): Promise<PlacedBet> {
  if (!isSelection(input.selection)) throw badRequest("invalid_selection", "Choose green, violet, red or a number 0-9");
  if (!isBetAmount(input.amount)) throw badRequest("invalid_amount", "Choose 10, 50, 100, 500 or 1000 virtual points");

  try {
    return await withTransaction(async (db) => {
      // FOR SHARE blocks the engine from closing/settling the round until this bet commits,
      // so a bet can never slip in after the betting window has been closed.
      const { rows: rounds } = await db.query<RoundRow>("SELECT * FROM game_rounds WHERE id = $1 FOR SHARE", [input.roundId]);
      const round = rounds[0];
      if (!round) throw new HttpError(404, "round_not_found", "Round not found");
      if (input.nowMs < round.starts_at.getTime()) throw conflict("round_not_started", "This round has not started yet");
      if (round.status !== "open" || input.nowMs >= round.betting_closes_at.getTime()) {
        throw conflict("betting_closed", "Betting is closed for this round");
      }

      const { rows: wallets } = await db.query<{ balance: number }>(
        "SELECT balance FROM virtual_wallets WHERE user_id = $1 FOR UPDATE",
        [input.userId],
      );
      const balance = wallets[0]?.balance ?? 0;
      if (balance < input.amount) throw badRequest("insufficient_points", "Not enough virtual points");

      const { rows: bets } = await db.query(
        `INSERT INTO bets (user_id, round_id, selection, amount, client_nonce, ip)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, selection, amount, status, payout, created_at`,
        [input.userId, round.id, input.selection, input.amount, input.nonce, input.ip ?? null],
      );
      const bet = bets[0];

      const { rows: w } = await db.query<{ balance: number }>(
        "UPDATE virtual_wallets SET balance = balance - $2, updated_at = now() WHERE user_id = $1 RETURNING balance",
        [input.userId, input.amount],
      );
      await db.query(
        `INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, bet_id, round_id, description)
         VALUES ($1, 'bet_debit', $2, $3, $4, $5, $6)`,
        [input.userId, -input.amount, w[0].balance, bet.id, round.id, `Bet on ${input.selection} - ${round.game} ${round.code}`],
      );

      return {
        bet: {
          id: bet.id,
          roundId: round.id,
          game: round.game,
          roundCode: round.code,
          selection: bet.selection,
          amount: bet.amount,
          status: bet.status,
          payout: bet.payout,
          createdAt: bet.created_at.toISOString(),
        },
        balance: w[0].balance,
      };
    });
  } catch (err) {
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === "23505" && pgErr.constraint === "bets_nonce_uq") {
      recordSecurityEvent(input.userId, "bet_replay", { roundId: input.roundId, nonce: input.nonce }, input.ip);
      throw conflict("replayed_request", "This bet request was already submitted");
    }
    if (pgErr.code === "23505" && pgErr.constraint === "bets_one_per_round") {
      recordSecurityEvent(input.userId, "duplicate_bet", { roundId: input.roundId }, input.ip);
      throw conflict("duplicate_bet", "You already placed a bet in this round");
    }
    if (pgErr.code === "22P02") throw badRequest("invalid_nonce", "Invalid request nonce");
    if (err instanceof HttpError && err.code === "betting_closed") {
      recordSecurityEvent(input.userId, "late_bet", { roundId: input.roundId }, input.ip);
    }
    throw err;
  }
}
