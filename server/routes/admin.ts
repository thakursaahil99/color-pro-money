import { Router } from "express";
import { z } from "zod";
import { COLORS, GAMES, SELECTIONS, slotAt, timingForSlot } from "../../shared/game";
import { normalizeMobile } from "../../shared/phone";
import { pool, withTransaction } from "../db/pool";
import { audit } from "../lib/audit";
import { requireAdmin } from "../lib/auth";
import { hashPassword } from "../lib/password";
import { getSettings, saveSettings } from "../lib/settings";
import { ah, badRequest, conflict, notFound } from "../lib/errors";
import { mobileSchema, passwordSchema } from "./auth";
import { rateLimit } from "../lib/rateLimit";
import { clock } from "../game/clock";
import { getCurrentRounds, isPaused, setPaused, toPublicRound } from "../game/rounds";

const ACTIVE_WINDOW_MINUTES = 15;

const pageSchema = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};

/**
 * Admin API. Every route requires an authenticated admin (checked server-side).
 * By design there is NO endpoint that can set, alter or influence a round result.
 */
export function createAdminRouter() {
  const r = Router();
  r.use(requireAdmin);
  r.use(rateLimit({ name: "admin", windowMs: 60_000, max: 300 }));

  // ------------------------------------------------------------ overview
  r.get(
    "/overview",
    ah(async (_req, res) => {
      const now = clock.now();
      const [{ rows: s }, rounds, paused] = await Promise.all([
        pool.query(
          `SELECT
             (SELECT COUNT(*) FROM users)::int AS total_users,
             (SELECT COUNT(*) FROM users WHERE last_seen_at > now() - make_interval(mins => $1))::int AS active_users,
             (SELECT COUNT(*) FROM users WHERE status = 'suspended')::int AS suspended_users,
             (SELECT COALESCE(SUM(amount), 0) FROM bets)::bigint AS total_wagered,
             (SELECT COALESCE(SUM(payout), 0) FROM bets)::bigint AS total_paid,
             (SELECT COUNT(*) FROM bets)::int AS total_bets,
             (SELECT COUNT(*) FROM game_rounds WHERE status = 'settled')::int AS completed_rounds,
             (SELECT COUNT(*) FROM bets WHERE created_at > now() - interval '24 hours')::int AS bets_24h,
             (SELECT COUNT(*) FROM points_requests WHERE status = 'pending')::int AS pending_recharges`,
          [ACTIVE_WINDOW_MINUTES],
        ),
        getCurrentRounds(pool, now),
        isPaused(pool),
      ]);
      // One entry per game: its current round plus live bet totals.
      const currentRounds = [];
      for (const round of rounds) {
        const { rows } = await pool.query(
          "SELECT COUNT(*)::int AS bets, COALESCE(SUM(amount), 0)::bigint AS points FROM bets WHERE round_id = $1",
          [round.id],
        );
        currentRounds.push({ ...toPublicRound(round), ...rows[0] });
      }
      const nextSlot = slotAt(now) + 1;
      const upcoming = paused ? [] : Array.from({ length: 5 }, (_, i) => timingForSlot(nextSlot + i));
      res.json({
        serverTime: now,
        stats: s[0],
        paused,
        currentRounds,
        upcoming,
      });
    }),
  );

  // ---------------------------------------------------- colour analytics
  r.get(
    "/analytics/colors",
    ah(async (req, res) => {
      const q = z
        .object({
          range: z.enum(["current", "24h", "7d", "all"]).default("all"),
          roundCode: z.string().max(20).optional(),
          game: z.enum(GAMES).optional(),
        })
        .parse(req.query);
      const params: unknown[] = [];
      const conds: string[] = [];
      if (q.game) conds.push(`r.game = $${params.push(q.game)}`);
      if (q.roundCode) conds.push(`r.code = $${params.push(q.roundCode)}`);
      else if (q.range === "current") {
        const ids = (await getCurrentRounds(pool, clock.now())).map((x) => x.id);
        conds.push(`b.round_id = ANY($${params.push(ids)}::bigint[])`);
      } else if (q.range === "24h") conds.push("b.created_at > now() - interval '24 hours'");
      else if (q.range === "7d") conds.push("b.created_at > now() - interval '7 days'");
      const where = conds.length ? conds.join(" AND ") : "TRUE";

      // Colour bets are grouped by colour; every bet on a number 0-9 is reported as one "numbers" group.
      const { rows } = await pool.query(
        `SELECT CASE WHEN b.selection IN ('red', 'green', 'violet') THEN b.selection ELSE 'numbers' END AS color,
                COUNT(*)::int AS bet_count, COALESCE(SUM(b.amount), 0)::bigint AS total_points
           FROM bets b JOIN game_rounds r ON r.id = b.round_id
          WHERE ${where}
          GROUP BY 1`,
        params,
      );
      const totalPoints = rows.reduce((a, x) => a + Number(x.total_points), 0);
      const totalBets = rows.reduce((a, x) => a + x.bet_count, 0);
      const colors = [...COLORS, "numbers" as const].map((color) => {
        const row = rows.find((x) => x.color === color);
        const points = Number(row?.total_points ?? 0);
        const count = row?.bet_count ?? 0;
        return {
          color,
          totalPoints: points,
          betCount: count,
          pointsPct: totalPoints ? +((points / totalPoints) * 100).toFixed(1) : 0,
          betsPct: totalBets ? +((count / totalBets) * 100).toFixed(1) : 0,
        };
      });
      res.json({ range: q.roundCode ? "round" : q.range, totalPoints, totalBets, colors });
    }),
  );

  r.get(
    "/analytics/rounds",
    ah(async (req, res) => {
      const { limit, game } = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(15), game: z.enum(GAMES).default("parity") })
        .parse(req.query);
      const { rows } = await pool.query(
        `SELECT r.code, r.status, gr.number AS result,
                COALESCE(SUM(b.amount) FILTER (WHERE b.selection = 'red'), 0)::bigint AS red,
                COALESCE(SUM(b.amount) FILTER (WHERE b.selection = 'green'), 0)::bigint AS green,
                COALESCE(SUM(b.amount) FILTER (WHERE b.selection = 'violet'), 0)::bigint AS violet
           FROM (SELECT * FROM game_rounds WHERE game = $2 ORDER BY starts_at DESC LIMIT $1) r
           LEFT JOIN bets b ON b.round_id = r.id
           LEFT JOIN game_results gr ON gr.round_id = r.id
          GROUP BY r.id, r.code, r.status, r.starts_at, gr.number
          ORDER BY r.starts_at ASC`,
        [limit, game],
      );
      res.json({ rounds: rows });
    }),
  );

  // ------------------------------------------------- individual bet records
  r.get(
    "/bets",
    ah(async (req, res) => {
      const q = z
        .object({
          ...pageSchema,
          userId: z.coerce.number().int().positive().optional(),
          roundCode: z.string().trim().max(20).optional(),
          game: z.enum(GAMES).optional(),
          selection: z.enum(SELECTIONS).optional(),
          status: z.enum(["pending", "won", "lost", "refunded"]).optional(),
        })
        .parse(req.query);
      const conds: string[] = [];
      const params: unknown[] = [];
      if (q.userId) conds.push(`b.user_id = $${params.push(q.userId)}`);
      if (q.roundCode) conds.push(`r.code = $${params.push(q.roundCode)}`);
      if (q.game) conds.push(`r.game = $${params.push(q.game)}`);
      if (q.selection) conds.push(`b.selection = $${params.push(q.selection)}`);
      if (q.status) conds.push(`b.status = $${params.push(q.status)}`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT b.id, b.user_id, u.username, b.round_id, r.game, r.code AS round_code, b.selection, b.amount, b.status, b.payout,
                b.created_at, b.settled_at, gr.number AS result_number
           FROM bets b
           JOIN game_rounds r ON r.id = b.round_id
           JOIN users u ON u.id = b.user_id
           LEFT JOIN game_results gr ON gr.round_id = b.round_id
           ${where}
          ORDER BY b.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM bets b JOIN game_rounds r ON r.id = b.round_id ${where}`,
        params,
      );
      res.json({ bets: rows, total: c[0].n, page: q.page, pageSize: q.pageSize });
    }),
  );

  // ------------------------------------------------------ round management
  r.get(
    "/rounds",
    ah(async (req, res) => {
      const q = z
        .object({ ...pageSchema, status: z.enum(["open", "closed", "settled"]).optional(), game: z.enum(GAMES).optional() })
        .parse(req.query);
      const params: unknown[] = [];
      const conds: string[] = [];
      if (q.status) conds.push(`r.status = $${params.push(q.status)}`);
      if (q.game) conds.push(`r.game = $${params.push(q.game)}`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      // The server seed is only returned for settled rounds (it is secret until then).
      const { rows } = await pool.query(
        `SELECT r.id, r.game, r.code, r.status, r.starts_at, r.betting_closes_at, r.ends_at, r.closed_at, r.settled_at,
                r.server_seed_hash AS commit_hash,
                CASE WHEN r.status = 'settled' THEN r.server_seed END AS server_seed,
                gr.number AS result, gr.price AS result_price, gr.created_at AS result_at,
                (SELECT COUNT(*) FROM bets b WHERE b.round_id = r.id)::int AS bet_count,
                (SELECT COALESCE(SUM(amount), 0) FROM bets b WHERE b.round_id = r.id)::bigint AS points_wagered,
                (SELECT COALESCE(SUM(payout), 0) FROM bets b WHERE b.round_id = r.id)::bigint AS points_awarded
           FROM game_rounds r LEFT JOIN game_results gr ON gr.round_id = r.id
           ${where}
          ORDER BY r.starts_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM game_rounds r ${where}`, params);
      const now = clock.now();
      const paused = await isPaused(pool);
      const upcoming = paused ? [] : Array.from({ length: 5 }, (_, i) => timingForSlot(slotAt(now) + 1 + i));
      res.json({ rounds: rows, total: c[0].n, page: q.page, pageSize: q.pageSize, paused, upcoming, serverTime: now });
    }),
  );

  r.post(
    "/rounds/pause",
    ah(async (req, res) => {
      const { paused, reason } = z.object({ paused: z.boolean(), reason: z.string().trim().min(3).max(500) }).parse(req.body);
      await withTransaction(async (db) => {
        await setPaused(db, paused, req.user!.id);
        await audit(db, {
          actor: "admin",
          adminUserId: req.user!.id,
          action: paused ? "rounds_paused" : "rounds_resumed",
          targetType: "system",
          targetId: "rounds",
          details: { reason },
          ip: req.ip,
        });
      });
      res.json({ paused });
    }),
  );

  // ----------------------------------------------------------- audit logs
  r.get(
    "/audit",
    ah(async (req, res) => {
      const q = z.object({ ...pageSchema, actor: z.enum(["admin", "system", "cli"]).optional() }).parse(req.query);
      const params: unknown[] = [];
      const where = q.actor ? `WHERE a.actor = $${params.push(q.actor)}` : "";
      const { rows } = await pool.query(
        `SELECT a.id, a.actor, a.admin_user_id, u.username AS admin_username, a.action, a.target_type, a.target_id,
                a.details, a.ip, a.entry_hash, a.created_at
           FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id
           ${where}
          ORDER BY a.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM admin_audit_logs a ${where}`, params);
      res.json({ logs: rows, total: c[0].n, page: q.page, pageSize: q.pageSize });
    }),
  );

  r.get(
    "/audit/verify",
    ah(async (_req, res) => {
      const { rows } = await pool.query(
        `WITH chain AS (
           SELECT id, prev_hash, entry_hash,
                  COALESCE(LAG(entry_hash) OVER (ORDER BY id), '') AS expected_prev,
                  encode(sha256(convert_to(
                    prev_hash || '|' || actor || '|' || COALESCE(admin_user_id::text, '') || '|' ||
                    action || '|' || COALESCE(target_type, '') || '|' || COALESCE(target_id, '') || '|' ||
                    details::text || '|' || to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
                    'UTF8')), 'hex') AS recomputed
             FROM admin_audit_logs)
         SELECT COUNT(*)::int AS entries,
                COUNT(*) FILTER (WHERE prev_hash <> expected_prev OR entry_hash <> recomputed)::int AS broken,
                MIN(id) FILTER (WHERE prev_hash <> expected_prev OR entry_hash <> recomputed) AS first_broken_id
           FROM chain`,
      );
      res.json({ ...rows[0], valid: rows[0].broken === 0 });
    }),
  );

  // ------------------------------------------------------- user management
  r.get(
    "/users",
    ah(async (req, res) => {
      const q = z
        .object({ ...pageSchema, q: z.string().trim().max(64).optional(), status: z.enum(["active", "suspended"]).optional() })
        .parse(req.query);
      const conds: string[] = [];
      const params: unknown[] = [];
      if (q.q) {
        const mobile = normalizeMobile(q.q);
        if (mobile) conds.push(`u.mobile = $${params.push(mobile)}`);
        else if (/^\d+$/.test(q.q)) conds.push(`u.id = $${params.push(Number(q.q))}`);
        else conds.push(`u.username ILIKE $${params.push(`%${q.q.replace(/[%_\\]/g, "\\$&")}%`)}`);
      }
      if (q.status) conds.push(`u.status = $${params.push(q.status)}`);
      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.mobile, u.role, u.status, u.created_at, u.last_seen_at, u.is_demo, w.balance,
                (SELECT COUNT(*) FROM bets b WHERE b.user_id = u.id)::int AS bet_count
           FROM users u LEFT JOIN virtual_wallets w ON w.user_id = u.id
           ${where}
          ORDER BY u.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM users u ${where}`, params);
      res.json({ users: rows, total: c[0].n, page: q.page, pageSize: q.pageSize });
    }),
  );

  r.get(
    "/users/:id",
    ah(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.mobile, u.email, u.role, u.status, u.suspended_reason, u.suspended_at, u.failed_login_count,
                u.created_at, u.last_login_at, u.last_seen_at, u.is_demo, w.balance
           FROM users u LEFT JOIN virtual_wallets w ON w.user_id = u.id WHERE u.id = $1`,
        [id],
      );
      if (!rows[0]) throw notFound("User not found");
      const [bets, txns, sessions, events, actions, stats] = await Promise.all([
        pool.query(
          `SELECT b.id, r.game, r.code AS round_code, b.selection, b.amount, b.status, b.payout, b.created_at, b.ip
             FROM bets b JOIN game_rounds r ON r.id = b.round_id WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 25`,
          [id],
        ),
        pool.query(
          "SELECT id, type, amount, balance_after, description, created_at FROM virtual_wallet_transactions WHERE user_id = $1 ORDER BY id DESC LIMIT 25",
          [id],
        ),
        pool.query(
          `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
             FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 15`,
          [id],
        ),
        pool.query("SELECT id, type, details, ip, created_at FROM security_events WHERE user_id = $1 ORDER BY id DESC LIMIT 50", [id]),
        pool.query(
          `SELECT a.id, a.action, a.details, a.created_at, u.username AS admin_username
             FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.admin_user_id
            WHERE a.target_type = 'user' AND a.target_id = $1 ORDER BY a.id DESC LIMIT 25`,
          [String(id)],
        ),
        pool.query(
          `SELECT COUNT(*)::int AS bets, COUNT(*) FILTER (WHERE status = 'won')::int AS wins,
                  COALESCE(SUM(amount), 0)::bigint AS wagered, COALESCE(SUM(payout), 0)::bigint AS awarded,
                  COUNT(DISTINCT ip)::int AS distinct_ips
             FROM bets WHERE user_id = $1`,
          [id],
        ),
      ]);
      const { rows: refInfo } = await pool.query(
        `SELECT (SELECT username FROM users WHERE id = (SELECT referrer_id FROM referrals WHERE referred_id = $1)) AS referred_by,
                (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1)::int AS referrals_made,
                (SELECT COALESCE(SUM(bonus), 0) FROM referrals WHERE referrer_id = $1)::bigint AS referral_earned,
                (SELECT referral_code FROM users WHERE id = $1) AS referral_code`,
        [id],
      );
      await audit(pool, { actor: "admin", adminUserId: req.user!.id, action: "user_viewed", targetType: "user", targetId: id, ip: req.ip });
      res.json({
        user: rows[0],
        stats: stats.rows[0],
        bets: bets.rows,
        transactions: txns.rows,
        sessions: sessions.rows,
        securityEvents: events.rows,
        adminActions: actions.rows,
        referral: refInfo[0],
      });
    }),
  );

  r.get(
    "/suspicious",
    ah(async (_req, res) => {
      // Users with unusual signals in the last 24h: failed logins, replays, duplicate/late bets, throttling.
      const { rows } = await pool.query(
        `SELECT u.id, u.username, u.status,
                COUNT(*)::int AS events,
                COUNT(*) FILTER (WHERE e.type = 'failed_login')::int AS failed_logins,
                COUNT(*) FILTER (WHERE e.type = 'bet_replay')::int AS replays,
                COUNT(*) FILTER (WHERE e.type = 'duplicate_bet')::int AS duplicate_bets,
                COUNT(*) FILTER (WHERE e.type = 'late_bet')::int AS late_bets,
                COUNT(*) FILTER (WHERE e.type = 'rate_limited')::int AS rate_limited,
                COUNT(DISTINCT e.ip)::int AS distinct_ips,
                MAX(e.created_at) AS last_event_at
           FROM security_events e JOIN users u ON u.id = e.user_id
          WHERE e.created_at > now() - interval '24 hours'
          GROUP BY u.id, u.username, u.status
          ORDER BY events DESC LIMIT 50`,
      );
      const { rows: anon } = await pool.query(
        `SELECT ip, type, COUNT(*)::int AS events, MAX(created_at) AS last_event_at
           FROM security_events WHERE user_id IS NULL AND created_at > now() - interval '24 hours'
          GROUP BY ip, type ORDER BY events DESC LIMIT 25`,
      );
      res.json({ users: rows, anonymous: anon });
    }),
  );

  const reasonSchema = z.object({ reason: z.string().trim().min(5, "please give a reason (min 5 chars)").max(500) });

  r.post(
    "/users/:id/suspend",
    ah(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { reason } = reasonSchema.parse(req.body);
      if (id === req.user!.id) throw badRequest("self_suspend", "You cannot suspend your own account");
      await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!rows[0]) throw notFound("User not found");
        if (rows[0].role === "admin") throw badRequest("admin_target", "Admin accounts cannot be suspended from the panel");
        if (rows[0].status === "suspended") throw badRequest("already_suspended", "User is already suspended");
        await db.query(
          "UPDATE users SET status = 'suspended', suspended_reason = $2, suspended_at = now(), updated_at = now() WHERE id = $1",
          [id, reason],
        );
        await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
        await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "user_suspended", targetType: "user", targetId: id, details: { reason }, ip: req.ip });
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    "/users/:id/unsuspend",
    ah(async (req, res) => {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const { reason } = reasonSchema.parse(req.body);
      await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT status FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!rows[0]) throw notFound("User not found");
        if (rows[0].status !== "suspended") throw badRequest("not_suspended", "User is not suspended");
        await db.query(
          "UPDATE users SET status = 'active', suspended_reason = NULL, suspended_at = NULL, updated_at = now() WHERE id = $1",
          [id],
        );
        await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "user_unsuspended", targetType: "user", targetId: id, details: { reason }, ip: req.ip });
      });
      res.json({ ok: true });
    }),
  );


  // ================================================================ settings
  r.get(
    "/settings",
    ah(async (_req, res) => {
      res.json({ settings: await getSettings(pool) });
    }),
  );

  const settingsSchema = z
    .object({
      startingPoints: z.number().int().min(0).max(1_000_000),
      referralBonus: z.number().int().min(0).max(100_000),
      registrationOpen: z.boolean(),
      gamesEnabled: z.object(Object.fromEntries(GAMES.map((g) => [g, z.boolean().optional()]))).partial(),
    })
    .partial()
    .strict();

  r.put(
    "/settings",
    ah(async (req, res) => {
      const patch = settingsSchema.parse(req.body);
      const result = await withTransaction(async (db) => {
        const { before, after } = await saveSettings(db, patch as Parameters<typeof saveSettings>[1], req.user!.id);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        for (const key of ["startingPoints", "referralBonus", "registrationOpen"] as const) {
          if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
        }
        for (const g of GAMES) {
          if (before.gamesEnabled[g] !== after.gamesEnabled[g]) changes[`game_${g}`] = { from: before.gamesEnabled[g], to: after.gamesEnabled[g] };
        }
        if (Object.keys(changes).length) {
          await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "settings_updated", targetType: "system", targetId: "settings", details: { changes }, ip: req.ip });
        }
        return after;
      });
      res.json({ settings: result });
    }),
  );

  // ============================================================ user editing
  const idParam = z.coerce.number().int().positive();

  r.patch(
    "/users/:id",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const body = z
        .object({
          username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/, "3-24 letters, numbers or underscores").optional(),
          mobile: mobileSchema.optional(),
        })
        .strict()
        .refine((b) => b.username !== undefined || b.mobile !== undefined, "nothing to change")
        .parse(req.body);
      try {
        await withTransaction(async (db) => {
          const { rows } = await db.query("SELECT username, mobile FROM users WHERE id = $1 FOR UPDATE", [id]);
          if (!rows[0]) throw notFound("User not found");
          const changes: Record<string, { from: unknown; to: unknown }> = {};
          if (body.username !== undefined && body.username !== rows[0].username) changes.username = { from: rows[0].username, to: body.username };
          if (body.mobile !== undefined && body.mobile !== rows[0].mobile) changes.mobile = { from: rows[0].mobile, to: body.mobile };
          if (!Object.keys(changes).length) return;
          await db.query("UPDATE users SET username = $2, mobile = $3, updated_at = now() WHERE id = $1", [
            id,
            body.username ?? rows[0].username,
            body.mobile ?? rows[0].mobile,
          ]);
          await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "user_updated", targetType: "user", targetId: id, details: { changes }, ip: req.ip });
        });
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505" && e.constraint === "users_mobile_uq") throw conflict("mobile_taken", "That mobile number belongs to another account");
        if (e.code === "23505") throw conflict("username_taken", "That nickname is taken");
        throw err;
      }
      res.json({ ok: true });
    }),
  );

  r.post(
    "/users/:id/reset-password",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const { password } = z.object({ password: passwordSchema }).parse(req.body);
      if (id === req.user!.id) throw badRequest("use_profile", "Change your own password from the Profile page");
      const hash = await hashPassword(password);
      await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT role FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!rows[0]) throw notFound("User not found");
        if (rows[0].role === "admin") throw badRequest("admin_target", "Admin passwords cannot be reset from the panel");
        await db.query("UPDATE users SET password_hash = $2, failed_login_count = 0, updated_at = now() WHERE id = $1", [id, hash]);
        await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
        // The new password itself is never written to the audit log.
        await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "user_password_reset", targetType: "user", targetId: id, ip: req.ip });
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    "/users/:id/logout",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const n = await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT 1 FROM users WHERE id = $1", [id]);
        if (!rows[0]) throw notFound("User not found");
        const r2 = await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
        await audit(db, { actor: "admin", adminUserId: req.user!.id, action: "user_signed_out", targetType: "user", targetId: id, details: { sessions: r2.rowCount }, ip: req.ip });
        return r2.rowCount ?? 0;
      });
      res.json({ ok: true, sessionsEnded: n });
    }),
  );

  r.post(
    "/users/:id/role",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const { role, reason } = z.object({ role: z.enum(["user", "admin"]), reason: z.string().trim().min(5, "please give a reason (min 5 chars)").max(500) }).parse(req.body);
      if (id === req.user!.id) throw badRequest("self_role", "You cannot change your own role");
      await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT role, status FROM users WHERE id = $1 FOR UPDATE", [id]);
        if (!rows[0]) throw notFound("User not found");
        if (rows[0].role === role) throw badRequest("no_change", `User is already ${role === "admin" ? "an admin" : "a regular player"}`);
        if (role === "admin" && rows[0].status !== "active") throw badRequest("not_active", "Reinstate this account before making it an admin");
        await db.query("UPDATE users SET role = $2, updated_at = now() WHERE id = $1", [id, role]);
        // Demoted admins lose access immediately.
        if (role === "user") await db.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [id]);
        await audit(db, {
          actor: "admin",
          adminUserId: req.user!.id,
          action: role === "admin" ? "user_promoted_to_admin" : "admin_demoted",
          targetType: "user",
          targetId: id,
          details: { reason },
          ip: req.ip,
        });
      });
      res.json({ ok: true });
    }),
  );

  // ============================================================ admin accounts
  r.get(
    "/admins",
    ah(async (_req, res) => {
      const { rows } = await pool.query(
        "SELECT id, username, email, mobile, status, created_at, last_login_at, last_seen_at FROM users WHERE role = 'admin' ORDER BY id",
      );
      res.json({ admins: rows });
    }),
  );

  r.post(
    "/admins",
    rateLimit({ name: "admin-create", windowMs: 60 * 60_000, max: 20 }),
    ah(async (req, res) => {
      const body = z
        .object({
          username: z.string().trim().regex(/^[A-Za-z0-9_]{3,24}$/, "3-24 letters, numbers or underscores"),
          email: z.string().trim().toLowerCase().email().max(254),
          password: passwordSchema,
        })
        .parse(req.body);
      const hash = await hashPassword(body.password);
      try {
        const id = await withTransaction(async (db) => {
          const { rows } = await db.query(
            "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
            [body.username, body.email, hash],
          );
          await db.query("INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, 0)", [rows[0].id]);
          await audit(db, {
            actor: "admin",
            adminUserId: req.user!.id,
            action: "admin_created",
            targetType: "user",
            targetId: rows[0].id,
            details: { username: body.username, email: body.email },
            ip: req.ip,
          });
          return rows[0].id as number;
        });
        res.status(201).json({ id });
      } catch (err) {
        if ((err as { code?: string }).code === "23505") throw conflict("account_exists", "That username or email is already used");
        throw err;
      }
    }),
  );

  // ================================================================ referrals
  r.get(
    "/referrals",
    ah(async (req, res) => {
      const q = z.object({ ...pageSchema }).parse(req.query);
      const { rows } = await pool.query(
        `SELECT f.id, f.bonus, f.created_at,
                f.referrer_id, a.username AS referrer_username,
                f.referred_id, b.username AS referred_username, b.mobile AS referred_mobile
           FROM referrals f JOIN users a ON a.id = f.referrer_id JOIN users b ON b.id = f.referred_id
          ORDER BY f.id DESC LIMIT $1 OFFSET $2`,
        [q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: t } = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(SUM(bonus), 0)::bigint AS total FROM referrals");
      res.json({ referrals: rows, total: t[0].n, totalBonus: t[0].total, page: q.page, pageSize: q.pageSize });
    }),
  );


  // =========================================================== recharge requests
  // Players ask for free virtual points; an admin approves or rejects each request. No payment is involved.
  r.get(
    "/recharges",
    ah(async (req, res) => {
      const q = z.object({ ...pageSchema, status: z.enum(["pending", "approved", "rejected"]).optional() }).parse(req.query);
      const params: unknown[] = [];
      const where = q.status ? `WHERE p.status = $${params.push(q.status)}` : "";
      const { rows } = await pool.query(
        `SELECT p.id, p.user_id, u.username, u.mobile, p.amount, p.status, p.reject_reason, p.created_at, p.decided_at,
                a.username AS decided_by_username, w.balance
           FROM points_requests p
           JOIN users u ON u.id = p.user_id
           LEFT JOIN virtual_wallets w ON w.user_id = p.user_id
           LEFT JOIN users a ON a.id = p.decided_by
           ${where}
          ORDER BY (p.status = 'pending') DESC, p.id DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, q.pageSize, (q.page - 1) * q.pageSize],
      );
      const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM points_requests p ${where}`, params);
      const { rows: pending } = await pool.query("SELECT COUNT(*)::int AS n FROM points_requests WHERE status = 'pending'");
      res.json({ requests: rows, total: c[0].n, pending: pending[0].n, page: q.page, pageSize: q.pageSize });
    }),
  );

  r.post(
    "/recharges/:id/approve",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const balance = await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT * FROM points_requests WHERE id = $1 FOR UPDATE", [id]);
        const p = rows[0];
        if (!p) throw notFound("Request not found");
        if (p.status !== "pending") throw conflict("already_decided", `This request was already ${p.status}`);
        if (p.user_id === req.user!.id) throw badRequest("self_request", "You cannot approve your own request");
        const { rows: w } = await db.query<{ balance: number }>(
          "UPDATE virtual_wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance",
          [p.user_id, p.amount],
        );
        await db.query(
          `INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, request_id, description)
           VALUES ($1, 'recharge_approved', $2, $3, $4, 'Recharge approved (free virtual points, no cash value)')`,
          [p.user_id, p.amount, w[0].balance, p.id],
        );
        await db.query("UPDATE points_requests SET status = 'approved', decided_by = $2, decided_at = now() WHERE id = $1", [id, req.user!.id]);
        await audit(db, {
          actor: "admin",
          adminUserId: req.user!.id,
          action: "recharge_approved",
          targetType: "user",
          targetId: p.user_id,
          details: { requestId: id, amount: p.amount },
          ip: req.ip,
        });
        return w[0].balance;
      });
      res.json({ ok: true, balance });
    }),
  );

  r.post(
    "/recharges/:id/reject",
    ah(async (req, res) => {
      const id = idParam.parse(req.params.id);
      const { reason } = z.object({ reason: z.string().trim().min(3, "please give a reason (min 3 chars)").max(300) }).parse(req.body);
      await withTransaction(async (db) => {
        const { rows } = await db.query("SELECT * FROM points_requests WHERE id = $1 FOR UPDATE", [id]);
        const p = rows[0];
        if (!p) throw notFound("Request not found");
        if (p.status !== "pending") throw conflict("already_decided", `This request was already ${p.status}`);
        await db.query(
          "UPDATE points_requests SET status = 'rejected', reject_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1",
          [id, reason, req.user!.id],
        );
        await audit(db, {
          actor: "admin",
          adminUserId: req.user!.id,
          action: "recharge_rejected",
          targetType: "user",
          targetId: p.user_id,
          details: { requestId: id, amount: p.amount, reason },
          ip: req.ip,
        });
      });
      res.json({ ok: true });
    }),
  );

  return r;
}
