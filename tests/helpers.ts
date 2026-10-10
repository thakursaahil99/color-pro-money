import crypto from "node:crypto";
import { timingForSlot, slotAt, type Game } from "../shared/game";
import { config } from "../server/config";
import { migrate } from "../server/db/migrate";
import { pool } from "../server/db/pool";
import { clock } from "../server/game/clock";
import { createRoundForSlot, type RoundRow } from "../server/game/rounds";
import { hashPassword } from "../server/lib/password";
import { flushSecurityEvents } from "../server/lib/security";

if (!config.databaseUrl.includes("test")) {
  throw new Error("Refusing to run tests: TEST_DATABASE_URL must point at a database whose name contains 'test'");
}

/** Wipes and re-creates the test database schema. */
export async function resetDb() {
  await flushSecurityEvents();
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrate(false);
  clock.reset();
}

export const TEST_PASSWORD = "TestPass1234";
let pwHash: Promise<string> | null = null;

export interface TestUser {
  id: number;
  username: string;
  mobile: string;
  cookie: string;
}

/** Creates a user with a wallet and a live session; returns the session cookie. */
export async function makeUser(opts: { role?: "user" | "admin"; balance?: number; username?: string } = {}): Promise<TestUser> {
  pwHash ??= hashPassword(TEST_PASSWORD);
  const username = opts.username ?? `u_${crypto.randomBytes(4).toString("hex")}`;
  const balance = opts.balance ?? 1000;
  const mobile = `9${crypto.randomInt(100_000_000, 1_000_000_000)}`;
  const { rows } = await pool.query(
    "INSERT INTO users (username, mobile, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
    [username, mobile, await pwHash, opts.role ?? "user"],
  );
  const id = rows[0].id as number;
  await pool.query("INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, $2)", [id, balance]);
  if (balance > 0) {
    await pool.query(
      "INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after) VALUES ($1, 'signup_bonus', $2, $2)",
      [id, balance],
    );
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await pool.query(
    "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')",
    [id, crypto.createHash("sha256").update(token).digest("hex")],
  );
  return { id, username, mobile, cookie: `${config.sessionCookie}=${token}` };
}

/** Creates an open round for a slot and freezes the clock `offsetMs` after it starts. */
export async function openRoundAt(offsetMs: number, slot = slotAt(Date.now()), game: Game = "parity"): Promise<RoundRow> {
  const t = timingForSlot(slot);
  const round = await createRoundForSlot(pool, slot, game);
  if (!round) throw new Error("round already exists");
  clock.set(() => t.startsAt + offsetMs);
  return round;
}

export async function balanceOf(userId: number): Promise<number> {
  const { rows } = await pool.query("SELECT balance FROM virtual_wallets WHERE user_id = $1", [userId]);
  return rows[0].balance;
}

/** Sum of all ledger entries for a user; must always equal the wallet balance. */
export async function ledgerSum(userId: number): Promise<number> {
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(amount), 0)::bigint AS s FROM virtual_wallet_transactions WHERE user_id = $1",
    [userId],
  );
  return rows[0].s;
}
