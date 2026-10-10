import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../server/config";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { balanceOf, ledgerSum, makeUser, resetDb } from "./helpers";

let app = createApp({ lazyEngine: false });
beforeEach(async () => {
  await resetDb();
  app = createApp({ lazyEngine: false });
});
afterAll(() => pool.end());

const register = (body: Record<string, unknown>) => request(app).post("/api/auth/register").send({ password: "Password123", ...body });
const codeOf = async (userId: number) => (await pool.query("SELECT referral_code FROM users WHERE id = $1", [userId])).rows[0].referral_code as string;

describe("referrals (virtual points only)", () => {
  it("the referrer receives the bonus when a friend registers with their code", async () => {
    const referrer = await makeUser({ balance: 0 });
    const res = await register({ mobile: "9812345678", ref: await codeOf(referrer.id) });
    expect(res.status).toBe(201);
    expect(await balanceOf(referrer.id)).toBe(config.referralBonus);
    expect(config.referralBonus).toBe(150);
    expect(await ledgerSum(referrer.id)).toBe(150);
    const { rows } = await pool.query("SELECT referrer_id, bonus FROM referrals");
    expect(rows).toEqual([{ referrer_id: referrer.id, bonus: 150 }]);
    const tx = await pool.query("SELECT type, amount, balance_after FROM virtual_wallet_transactions WHERE user_id = $1", [referrer.id]);
    expect(tx.rows).toEqual([{ type: "referral_bonus", amount: 150, balance_after: 150 }]);
  });

  it("every successful referral pays again, and codes are case-insensitive", async () => {
    const referrer = await makeUser({ balance: 0 });
    const code = await codeOf(referrer.id);
    expect((await register({ mobile: "9812345671", ref: code })).status).toBe(201);
    expect((await register({ mobile: "9812345672", ref: code.toLowerCase() })).status).toBe(201);
    expect((await register({ mobile: "9812345673", ref: ` ${code} ` })).status).toBe(201);
    expect(await balanceOf(referrer.id)).toBe(450);
    expect(await ledgerSum(referrer.id)).toBe(450);
  });

  it("an unknown code is rejected and no account is created", async () => {
    const res = await register({ mobile: "9812345679", ref: "NOSUCHCODE" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_referral");
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE mobile = '9812345679'")).rows[0].n).toBe(0);
  });

  it("registering without a code pays nobody", async () => {
    const someone = await makeUser({ balance: 0 });
    expect((await register({ mobile: "9812345670" })).status).toBe(201);
    expect(await balanceOf(someone.id)).toBe(0);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM referrals")).rows[0].n).toBe(0);
  });

  it("a suspended or admin account's code does not work", async () => {
    const admin = await makeUser({ role: "admin" });
    expect((await register({ mobile: "9812345601", ref: await codeOf(admin.id) })).status).toBe(400);
    const banned = await makeUser();
    await pool.query("UPDATE users SET status = 'suspended', suspended_reason = 'test' WHERE id = $1", [banned.id]);
    expect((await register({ mobile: "9812345602", ref: await codeOf(banned.id) })).status).toBe(400);
  });

  it("/me/referral shows the code, friends joined and points earned", async () => {
    const referrer = await makeUser({ balance: 0 });
    await register({ mobile: "9812345611", ref: await codeOf(referrer.id) });
    await register({ mobile: "9812345612", ref: await codeOf(referrer.id) });
    const res = await request(app).get("/api/me/referral").set("Cookie", referrer.cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ invited: 2, earned: 300, bonusPerReferral: 150 });
    expect(res.body.code).toMatch(/^[0-9A-F]{8}$/);
    expect((await request(app).get("/api/me/referral")).status).toBe(401);
  });

  it("referral records cannot be edited or deleted", async () => {
    const referrer = await makeUser({ balance: 0 });
    await register({ mobile: "9812345621", ref: await codeOf(referrer.id) });
    await expect(pool.query("UPDATE referrals SET bonus = 99999")).rejects.toThrow(/not allowed/);
    await expect(pool.query("DELETE FROM referrals")).rejects.toThrow(/not allowed/);
  });
});

describe("starting balance", () => {
  it("new accounts can start with 0 virtual points (no ledger row)", async () => {
    const before = config.startingPoints;
    config.startingPoints = 0;
    try {
      const res = await register({ mobile: "9812345631" });
      expect(res.status).toBe(201);
      const me = await request(app).get("/api/auth/me").set("Cookie", res.headers["set-cookie"]);
      expect(me.body.balance).toBe(0);
      expect((await pool.query("SELECT COUNT(*)::int AS n FROM virtual_wallet_transactions")).rows[0].n).toBe(0);
    } finally {
      config.startingPoints = before;
    }
  });

  it("an account with 0 points cannot place a bet", async () => {
    const { openRoundAt } = await import("./helpers");
    const u = await makeUser({ balance: 0 });
    const round = await openRoundAt(1_000);
    const res = await request(app)
      .post("/api/game/bets")
      .set("Cookie", u.cookie)
      .send({ roundId: round.id, selection: "red", amount: 10, nonce: crypto.randomUUID() });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("insufficient_points");
  });
});
