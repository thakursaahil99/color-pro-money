import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { normalizeMobile } from "../../shared/phone";
import { config } from "../config";
import { pool, withTransaction } from "../db/pool";
import { clearSessionCookie, createSession, requireUser, revokeSessionToken, setSessionCookie } from "../lib/auth";
import { ah, badRequest, conflict, forbidden, HttpError } from "../lib/errors";
import { getDummyHash, hashPassword, verifyPassword } from "../lib/password";
import { rateLimit } from "../lib/rateLimit";
import { getSettings } from "../lib/settings";
import { recordSecurityEvent } from "../lib/security";

export const passwordSchema = z
  .string()
  .min(8, "must be at least 8 characters")
  .max(128)
  .regex(/[A-Za-z]/, "must contain a letter")
  .regex(/[0-9]/, "must contain a number");

export const mobileSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v, ctx) => {
    const m = normalizeMobile(v);
    if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "enter a valid 10-digit mobile number" });
    return m ?? "";
  });

const registerSchema = z.object({
  mobile: mobileSchema,
  password: passwordSchema,
  // Optional nickname; one is generated if left blank.
  username: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_]{3,24}$/, "3-24 letters, numbers or underscores")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  // Optional referral code of the friend who invited this player.
  ref: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => (v ? v.toUpperCase() : undefined)),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128),
});

/** Built per app instance so each app gets its own rate-limit buckets. */
export function createAuthRouter() {
  const authRouter = Router();

  authRouter.post(
    "/register",
    rateLimit({ name: "register", windowMs: 60 * 60_000, max: 10, key: (req) => `ip:${req.ip}` }),
    ah(async (req, res) => {
      const body = registerSchema.parse(req.body);
      const settings = await getSettings();
      if (!settings.registrationOpen) throw forbidden("New registrations are closed right now");
      const username = body.username ?? `Member${crypto.randomInt(100000, 1000000)}`;
      const passwordHash = await hashPassword(body.password);
      try {
        const user = await withTransaction(async (db) => {
          const { rows } = await db.query(
            `INSERT INTO users (username, mobile, password_hash, last_login_at, last_seen_at)
           VALUES ($1, $2, $3, now(), now()) RETURNING id, username, mobile, role`,
            [username, body.mobile, passwordHash],
          );
          const u = rows[0];
          await db.query("INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, $2)", [u.id, settings.startingPoints]);
          if (settings.startingPoints > 0) {
            await db.query(
              `INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, description)
             VALUES ($1, 'signup_bonus', $2, $2, 'Welcome bonus (virtual points, no cash value)')`,
              [u.id, settings.startingPoints],
            );
          }

          // Referral: the friend who invited this player gets the bonus (virtual points), once per new player.
          if (body.ref) {
            const { rows: refs } = await db.query(
              "SELECT id FROM users WHERE referral_code = $1 AND role = 'user' AND status = 'active'",
              [body.ref],
            );
            if (!refs[0]) throw badRequest("invalid_referral", "That referral code is not valid");
            await db.query("INSERT INTO referrals (referrer_id, referred_id, bonus) VALUES ($1, $2, $3)", [
              refs[0].id,
              u.id,
              settings.referralBonus,
            ]);
            if (settings.referralBonus > 0) {
              const { rows: w } = await db.query<{ balance: number }>(
                "UPDATE virtual_wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1 RETURNING balance",
                [refs[0].id, settings.referralBonus],
              );
              await db.query(
                `INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, description)
               VALUES ($1, 'referral_bonus', $2, $3, $4)`,
                [refs[0].id, settings.referralBonus, w[0].balance, `Referral bonus: ${u.username} joined with your code`],
              );
            }
          }
          const token = await createSession(db, u.id, req);
          return { ...u, token };
        });
        setSessionCookie(res, user.token);
        res.status(201).json({ user: { id: user.id, username: user.username, mobile: user.mobile, role: user.role } });
      } catch (err) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === "23505" && e.constraint === "users_mobile_uq") throw conflict("account_exists", "This mobile number is already registered");
        if (e.code === "23505" && e.constraint === "users_username_lower_uq") throw conflict("username_taken", "That nickname is taken, please choose another");
        if (e.code === "23505") throw conflict("conflict", "Please try again");
        throw err;
      }
    }),
  );

  authRouter.post(
    "/login",
    rateLimit({ name: "login", windowMs: 15 * 60_000, max: 10, key: (req) => `ip:${req.ip}` }),
    ah(async (req, res) => {
      const { identifier, password } = loginSchema.parse(req.body);
      // Players log in with their mobile number; admins (created from the CLI) with their email or username.
      const mobile = normalizeMobile(identifier);
      const { rows } = await pool.query(
        `SELECT id, username, mobile, role, status, suspended_reason, password_hash
         FROM users WHERE ($2::text IS NOT NULL AND mobile = $2) OR lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
        [identifier, mobile],
      );
      const user = rows[0];
      const ok = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) {
        if (user) {
          await pool.query("UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = $1", [user.id]);
          recordSecurityEvent(user.id, "failed_login", {}, req.ip);
        }
        throw new HttpError(401, "invalid_credentials", "Invalid mobile number or password");
      }
      if (user.status === "suspended") {
        recordSecurityEvent(user.id, "suspended_login_attempt", {}, req.ip);
        throw forbidden(`Account suspended: ${user.suspended_reason}`);
      }
      await pool.query("UPDATE users SET failed_login_count = 0, last_login_at = now(), last_seen_at = now() WHERE id = $1", [user.id]);
      const token = await createSession(pool, user.id, req);
      setSessionCookie(res, token);
      res.json({ user: { id: user.id, username: user.username, mobile: user.mobile, role: user.role } });
    }),
  );

  authRouter.post(
    "/logout",
    ah(async (req, res) => {
      const token = req.cookies?.[config.sessionCookie];
      if (typeof token === "string") await revokeSessionToken(token);
      clearSessionCookie(res);
      res.json({ ok: true });
    }),
  );

  authRouter.get(
    "/me",
    requireUser,
    ah(async (req, res) => {
      const { rows } = await pool.query("SELECT balance FROM virtual_wallets WHERE user_id = $1", [req.user!.id]);
      const u = req.user!;
      res.json({ user: { id: u.id, username: u.username, mobile: u.mobile, role: u.role }, balance: rows[0]?.balance ?? 0 });
    }),
  );

  return authRouter;
}
