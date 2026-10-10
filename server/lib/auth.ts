import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { pool, type Db } from "../db/pool";
import { forbidden, unauthorized } from "./errors";

export interface AuthUser {
  id: number;
  username: string;
  mobile: string | null;
  role: "user" | "admin";
  status: "active" | "suspended";
}

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export async function createSession(db: Db, userId: number, req: Request): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  await db.query(
    `INSERT INTO sessions (user_id, token_hash, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5))`,
    [userId, sha256(token), req.ip ?? null, (req.get("user-agent") ?? "").slice(0, 300), config.sessionTtlHours],
  );
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(config.sessionCookie, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    maxAge: config.sessionTtlHours * 3600_000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(config.sessionCookie, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/" });
}

export async function revokeSessionToken(token: string) {
  await pool.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(token)]);
}

/** Resolves the session cookie to a user. Never trusts anything else from the client. */
export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[config.sessionCookie];
    if (typeof token === "string" && token.length > 20 && token.length < 100) {
      const { rows } = await pool.query(
        `SELECT s.id AS session_id, s.last_seen_at, u.id, u.username, u.mobile, u.role, u.status
           FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
        [sha256(token)],
      );
      const row = rows[0];
      if (row && row.status === "active") {
        req.user = { id: row.id, username: row.username, mobile: row.mobile, role: row.role, status: row.status };
        req.sessionId = row.session_id;
        // Touch activity at most once a minute.
        if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
          pool.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [row.session_id]).catch(() => {});
          pool.query("UPDATE users SET last_seen_at = now() WHERE id = $1", [row.id]).catch(() => {});
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

/** Role checks are always enforced here on the server, never in the UI alone. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden("Admin access required"));
  next();
}

/**
 * CSRF defence for state-changing requests: cookies are SameSite=Lax, bodies must be JSON
 * (which cross-site forms cannot send without a CORS preflight), and a present Origin must match.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin && origin !== config.appOrigin) {
    const host = req.get("host");
    if (!host || new URL(origin).host !== host) return next(forbidden("Cross-site request blocked"));
  }
  const len = req.headers["content-length"];
  const hasBody = (len !== undefined && len !== "0") || req.headers["transfer-encoding"] !== undefined;
  if (hasBody && !req.is("application/json")) {
    return next(forbidden("JSON body required"));
  }
  next();
}
