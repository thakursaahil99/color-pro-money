import { Router } from "express";
import { z } from "zod";
import { BET_AMOUNTS, GAMES, SELECTIONS } from "../../shared/game";
import { pool } from "../db/pool";
import { requireUser } from "../lib/auth";
import { ah } from "../lib/errors";
import { rateLimit } from "../lib/rateLimit";
import { getSettings } from "../lib/settings";
import { placeBet } from "../game/betting";
import { clock } from "../game/clock";
import { getCurrentRounds, getRecentResults, isPaused, toPublicRound } from "../game/rounds";

const betSchema = z.object({
  roundId: z.number().int().positive(),
  selection: z.enum(SELECTIONS),
  amount: z.number().int().refine((v) => (BET_AMOUNTS as readonly number[]).includes(v), "invalid amount"),
  nonce: z.string().uuid(),
});

export function createGameRouter() {
  const r = Router();

  // Public state: every game's current round, server time for clock sync, recent results.
  r.get(
    "/state",
    ah(async (req, res) => {
      const now = clock.now();
      const [rounds, paused, recent, settings] = await Promise.all([
        getCurrentRounds(pool, now),
        isPaused(pool),
        getRecentResults(pool, 20),
        getSettings(pool),
      ]);
      let myBets: unknown[] = [];
      if (req.user && rounds.length) {
        const { rows } = await pool.query(
          `SELECT id, round_id, selection, amount, status, payout, created_at
             FROM bets WHERE user_id = $1 AND round_id = ANY($2::bigint[])`,
          [req.user.id, rounds.map((x) => x.id)],
        );
        myBets = rows;
      }
      const disabledGames = GAMES.filter((g) => !settings.gamesEnabled[g]);
      res.json({ serverTime: now, rounds: rounds.map(toPublicRound), paused, disabledGames, recent, myBets });
    }),
  );

  // Public result history (the "Record" table), including revealed seeds so anyone can verify fairness.
  r.get(
    "/results",
    ah(async (req, res) => {
      const q = z
        .object({
          game: z.enum(GAMES).default("parity"),
          page: z.coerce.number().int().min(1).max(10_000).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(10),
        })
        .parse(req.query);
      const { rows } = await pool.query(
        `SELECT r.code, r.game, gr.number, gr.price, r.server_seed_hash AS commit_hash, gr.server_seed, gr.created_at
           FROM game_results gr JOIN game_rounds r ON r.id = gr.round_id
          WHERE r.game = $1
          ORDER BY r.starts_at DESC LIMIT $2 OFFSET $3`,
        [q.game, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(
        "SELECT COUNT(*)::int AS n FROM game_results gr JOIN game_rounds r ON r.id = gr.round_id WHERE r.game = $1",
        [q.game],
      );
      res.json({ results: rows, total: c[0].n, page: q.page, pageSize: q.pageSize });
    }),
  );

  r.post(
    "/bets",
    requireUser,
    rateLimit({ name: "bets", windowMs: 60_000, max: 20 }),
    ah(async (req, res) => {
      const body = betSchema.parse(req.body);
      // Only the chosen selection, chip value, round and nonce come from the client.
      const result = await placeBet({ ...body, userId: req.user!.id, ip: req.ip, nowMs: clock.now() });
      res.status(201).json(result);
    }),
  );

  return r;
}
