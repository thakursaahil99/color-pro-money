import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GAMES, payoutFor, type Selection } from "../shared/game";
import { pool } from "../server/db/pool";
import { placeBet } from "../server/game/betting";
import { clock } from "../server/game/clock";
import type { RoundRow } from "../server/game/rounds";
import { settleRound } from "../server/game/settlement";
import { hashSeed, resultFromSeed } from "../server/lib/rng";
import { balanceOf, ledgerSum, makeUser, openRoundAt, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => pool.end());

async function betFor(userId: number, roundId: number, selection: Selection, amount: number) {
  return placeBet({ userId, roundId, selection, amount, nonce: crypto.randomUUID(), nowMs: clock.now() });
}

const predict = (r: RoundRow) => resultFromSeed(r.server_seed, r.game, r.code);

describe("point accounting", () => {
  it("pays exact-number winners 9x, colour winners per the rules, losers nothing, and keeps wallets equal to the ledger", async () => {
    const round = await openRoundAt(1_000);
    const n = predict(round).number;
    const other = String((n + 1) % 10) as Selection;
    const exact = await makeUser({ balance: 1000 });
    const loser = await makeUser({ balance: 1000 });
    const colour = await makeUser({ balance: 1000 });
    // a colour that wins for this number: green for odd, red for even
    const colourSel: Selection = n % 2 === 1 ? "green" : "red";
    await betFor(exact.id, round.id, String(n) as Selection, 100);
    await betFor(loser.id, round.id, other, 100);
    await betFor(colour.id, round.id, colourSel, 100);

    const outcome = await settleRound(round.id);
    expect(outcome?.number).toBe(n);
    expect(outcome?.winners).toBe(2);
    expect(outcome?.losers).toBe(1);
    expect(outcome?.totalPaid).toBe(900 + payoutFor(colourSel, 100, n));

    expect(await balanceOf(exact.id)).toBe(1000 - 100 + 900);
    expect(await balanceOf(loser.id)).toBe(900);
    expect(await balanceOf(colour.id)).toBe(1000 - 100 + payoutFor(colourSel, 100, n));
    for (const u of [exact, loser, colour]) expect(await ledgerSum(u.id)).toBe(await balanceOf(u.id));

    const { rows } = await pool.query("SELECT user_id, status, payout FROM bets ORDER BY user_id");
    expect(rows).toEqual([
      { user_id: exact.id, status: "won", payout: 900 },
      { user_id: loser.id, status: "lost", payout: 0 },
      { user_id: colour.id, status: "won", payout: payoutFor(colourSel, 100, n) },
    ]);
  });

  it("settles a round only once (idempotent, no double payouts)", async () => {
    const round = await openRoundAt(1_000);
    const n = predict(round).number;
    const u = await makeUser();
    await betFor(u.id, round.id, String(n) as Selection, 100);
    const results = await Promise.all([settleRound(round.id), settleRound(round.id), settleRound(round.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await settleRound(round.id)).toBeNull();
    expect(await balanceOf(u.id)).toBe(1000 - 100 + 900);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM virtual_wallet_transactions WHERE type = 'bet_payout'");
    expect(rows[0].n).toBe(1);
  });

  it("the result is independent of the bets placed", async () => {
    const round = await openRoundAt(1_000);
    const predicted = predict(round);
    // Everyone bets heavily on every number except the predicted one; the result must not move.
    for (let i = 0; i < 9; i++) {
      const u = await makeUser({ balance: 5000 });
      await betFor(u.id, round.id, String((predicted.number + 1 + i) % 10) as Selection, 1000);
    }
    const outcome = await settleRound(round.id);
    expect(outcome?.number).toBe(predicted.number);
    expect(outcome?.price).toBe(predicted.price);
    expect(hashSeed(outcome!.serverSeed)).toBe(round.server_seed_hash);
  });

  it("the four games settle independently, each from its own seed", async () => {
    for (const game of GAMES) await openRoundAt(1_000, undefined, game);
    const { rows } = await pool.query("SELECT id, game FROM game_rounds ORDER BY game");
    expect(rows.map((r) => r.game)).toEqual([...GAMES].sort());
    const seeds = await pool.query("SELECT COUNT(DISTINCT server_seed)::int AS n FROM game_rounds");
    expect(seeds.rows[0].n).toBe(4);
    for (const r of rows) expect(await settleRound(r.id)).not.toBeNull();
    const done = await pool.query("SELECT COUNT(*)::int AS n FROM game_results");
    expect(done.rows[0].n).toBe(4);
  });

  it("totals balance: points out of wallets equal stakes minus payouts", async () => {
    const round = await openRoundAt(1_000);
    const users = await Promise.all(Array.from({ length: 12 }, () => makeUser({ balance: 2000 })));
    const picks: Selection[] = ["green", "violet", "red", "0", "1", "2", "3", "4", "5", "6", "7", "8"];
    let i = 0;
    for (const u of users) {
      await betFor(u.id, round.id, picks[i], [10, 50, 100, 500, 1000][i % 5]);
      i++;
    }
    await settleRound(round.id);
    const { rows } = await pool.query(
      "SELECT SUM(amount)::bigint AS staked, SUM(payout)::bigint AS paid FROM bets WHERE round_id = $1",
      [round.id],
    );
    let total = 0;
    for (const u of users) {
      total += await balanceOf(u.id);
      expect(await ledgerSum(u.id)).toBe(await balanceOf(u.id));
    }
    expect(total).toBe(12 * 2000 - rows[0].staked + rows[0].paid);
  });
});

describe("result immutability", () => {
  it("results, ledger entries and seeds cannot be modified", async () => {
    const round = await openRoundAt(1_000);
    const u = await makeUser();
    await betFor(u.id, round.id, "red", 10);
    await settleRound(round.id);

    await expect(pool.query("UPDATE game_results SET number = 3")).rejects.toThrow(/not allowed/);
    await expect(pool.query("DELETE FROM game_results")).rejects.toThrow(/not allowed/);
    await expect(pool.query("UPDATE game_rounds SET server_seed = 'x'")).rejects.toThrow(/immutable/);
    await expect(pool.query("UPDATE game_rounds SET status = 'open'")).rejects.toThrow(/re-opened/);
    await expect(pool.query("UPDATE virtual_wallet_transactions SET amount = 1000000")).rejects.toThrow(/not allowed/);
    await expect(pool.query("UPDATE bets SET status = 'won', payout = 99999")).rejects.toThrow(/final/);
  });

  it("a seed cannot be swapped before settlement either", async () => {
    const round = await openRoundAt(1_000);
    await expect(pool.query("UPDATE game_rounds SET server_seed = 'abc' WHERE id = $1", [round.id])).rejects.toThrow(/immutable/);
  });
});
