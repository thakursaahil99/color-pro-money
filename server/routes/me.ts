import { Router } from "express";
import { z } from "zod";
import { GAMES } from "../../shared/game";
import { RECHARGE_AMOUNTS, isRechargeAmount } from "../../shared/recharge";
import { pool, withTransaction } from "../db/pool";
import { requireUser } from "../lib/auth";
import { ah, badRequest, conflict } from "../lib/errors";
import { hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "../lib/rateLimit";
import { getSettings } from "../lib/settings";
import { passwordSchema } from "./auth";

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export function createMeRouter() {
  const r = Router();
  r.use(requireUser);

  r.get(
    "/profile",
    ah(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.mobile, u.role, u.created_at, u.last_login_at, w.balance,
                (SELECT COUNT(*) FROM bets b WHERE b.user_id = u.id)::int AS total_bets,
                (SELECT COUNT(*) FROM bets b WHERE b.user_id = u.id AND b.status = 'won')::int AS wins,
                (SELECT COALESCE(SUM(amount), 0) FROM bets b WHERE b.user_id = u.id)::bigint AS total_wagered,
                (SELECT COALESCE(SUM(payout), 0) FROM bets b WHERE b.user_id = u.id)::bigint AS total_won
           FROM users u JOIN virtual_wallets w ON w.user_id = u.id
          WHERE u.id = $1`,
        [req.user!.id],
      );
      res.json({ profile: rows[0] });
    }),
  );

  r.get(
    "/referral",
    ah(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT u.referral_code AS code,
                (SELECT COUNT(*) FROM referrals WHERE referrer_id = u.id)::int AS invited,
                (SELECT COALESCE(SUM(bonus), 0) FROM referrals WHERE referrer_id = u.id)::bigint AS earned
           FROM users u WHERE u.id = $1`,
        [req.user!.id],
      );
      res.json({ ...rows[0], bonusPerReferral: (await getSettings()).referralBonus });
    }),
  );

  // Free recharge requests: ask an admin for virtual points. No payment of any kind is involved.
  r.get(
    "/recharge",
    ah(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT id, amount, status, reject_reason, created_at, decided_at
           FROM points_requests WHERE user_id = $1 ORDER BY id DESC LIMIT 20`,
        [req.user!.id],
      );
      res.json({
        amounts: RECHARGE_AMOUNTS,
        pending: rows.find((x) => x.status === "pending") ?? null,
        history: rows,
      });
    }),
  );

  r.post(
    "/recharge",
    rateLimit({ name: "recharge-request", windowMs: 60 * 60_000, max: 10 }),
    ah(async (req, res) => {
      const { amount } = z.object({ amount: z.number() }).parse(req.body);
      if (!isRechargeAmount(amount)) throw badRequest("invalid_amount", `Choose ${RECHARGE_AMOUNTS.join(" or ")} virtual points`);
      try {
        const { rows } = await pool.query(
          "INSERT INTO points_requests (user_id, amount) VALUES ($1, $2) RETURNING id, amount, status, created_at",
          [req.user!.id, amount],
        );
        res.status(201).json({ request: rows[0] });
      } catch (err) {
        if ((err as { constraint?: string }).constraint === "points_requests_one_pending") {
          throw conflict("request_pending", "You already have a recharge request waiting for approval");
        }
        throw err;
      }
    }),
  );

  r.patch(
    "/profile",
    rateLimit({ name: "profile", windowMs: 15 * 60_000, max: 20 }),
    ah(async (req, res) => {
      const { username } = z
        .object({ username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/, "3-24 letters, numbers or underscores") })
        .parse(req.body);
      try {
        await pool.query("UPDATE users SET username = $2, updated_at = now() WHERE id = $1", [req.user!.id, username]);
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw conflict("username_taken", "That nickname is taken");
        throw err;
      }
      res.json({ ok: true });
    }),
  );

  r.post(
    "/password",
    rateLimit({ name: "password", windowMs: 15 * 60_000, max: 5 }),
    ah(async (req, res) => {
      const body = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).parse(req.body);
      const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
      if (!(await verifyPassword(body.currentPassword, rows[0].password_hash))) {
        throw badRequest("wrong_password", "Current password is incorrect");
      }
      const hash = await hashPassword(body.newPassword);
      await withTransaction(async (db) => {
        await db.query("UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1", [req.user!.id, hash]);
        // Sign out every other device.
        await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [
          req.user!.id,
          req.sessionId,
        ]);
      });
      res.json({ ok: true });
    }),
  );

  r.get(
    "/bets",
    ah(async (req, res) => {
      const { page, pageSize } = pageSchema.parse(req.query);
      const { game } = z.object({ game: z.enum(GAMES).optional() }).parse(req.query);
      const params: unknown[] = [req.user!.id];
      const gameCond = game ? `AND r.game = $${params.push(game)}` : "";
      const { rows } = await pool.query(
        `SELECT b.id, r.game, r.code AS round_code, b.selection, b.amount, b.status, b.payout, b.created_at, b.settled_at,
                gr.number AS result_number
           FROM bets b JOIN game_rounds r ON r.id = b.round_id
           LEFT JOIN game_results gr ON gr.round_id = b.round_id
          WHERE b.user_id = $1 ${gameCond}
          ORDER BY b.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, pageSize, (page - 1) * pageSize],
      );
      const { rows: c } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM bets b JOIN game_rounds r ON r.id = b.round_id WHERE b.user_id = $1 ${gameCond}`,
        params,
      );
      res.json({ bets: rows, total: c[0].n, page, pageSize });
    }),
  );

  r.get(
    "/transactions",
    ah(async (req, res) => {
      const { page, pageSize } = pageSchema.parse(req.query);
      const { rows } = await pool.query(
        `SELECT t.id, t.type, t.amount, t.balance_after, t.description, t.created_at, r.code AS round_code
           FROM virtual_wallet_transactions t LEFT JOIN game_rounds r ON r.id = t.round_id
          WHERE t.user_id = $1
          ORDER BY t.id DESC LIMIT $2 OFFSET $3`,
        [req.user!.id, pageSize, (page - 1) * pageSize],
      );
      const { rows: c } = await pool.query("SELECT COUNT(*)::int AS n FROM virtual_wallet_transactions WHERE user_id = $1", [
        req.user!.id,
      ]);
      res.json({ transactions: rows, total: c[0].n, page, pageSize });
    }),
  );

  return r;
}
