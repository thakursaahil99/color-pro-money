import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GAMES, ROUND_DURATION_MS, slotAt, timingForSlot } from "../shared/game";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { clock } from "../server/game/clock";
import { GameEngine } from "../server/game/engine";
import { TEST_PASSWORD, makeUser, resetDb } from "./helpers";

let app = createApp({ lazyEngine: false });
beforeEach(async () => {
  await resetDb();
  app = createApp({ lazyEngine: false });
});
afterAll(() => pool.end());

const as = (cookie: string) => ({
  get: (p: string) => request(app).get(p).set("Cookie", cookie),
  post: (p: string, body: object = {}) => request(app).post(p).set("Cookie", cookie).send(body),
  put: (p: string, body: object = {}) => request(app).put(p).set("Cookie", cookie).send(body),
  patch: (p: string, body: object = {}) => request(app).patch(p).set("Cookie", cookie).send(body),
});
const auditActions = async () => (await pool.query("SELECT action FROM admin_audit_logs ORDER BY id")).rows.map((r) => r.action);

describe("admin settings", () => {
  it("only admins can read or change settings", async () => {
    const u = await makeUser();
    expect((await as(u.cookie).get("/api/admin/settings")).status).toBe(403);
    expect((await as(u.cookie).put("/api/admin/settings", { startingPoints: 5 })).status).toBe(403);
    expect((await request(app).get("/api/admin/settings")).status).toBe(401);
  });

  it("changes are validated, saved, and written to the audit log", async () => {
    const a = await makeUser({ role: "admin" });
    const admin = as(a.cookie);
    expect((await admin.get("/api/admin/settings")).body.settings).toMatchObject({ startingPoints: 1000, referralBonus: 150, registrationOpen: true });
    for (const bad of [{ startingPoints: -1 }, { referralBonus: 1.5 }, { registrationOpen: "yes" }, { surprise: true }]) {
      expect((await admin.put("/api/admin/settings", bad)).status).toBe(400);
    }
    const ok = await admin.put("/api/admin/settings", { startingPoints: 250, referralBonus: 75, gamesEnabled: { sapre: false } });
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({ startingPoints: 250, referralBonus: 75 });
    expect(ok.body.settings.gamesEnabled).toMatchObject({ parity: true, sapre: false });
    const { rows } = await pool.query("SELECT details FROM admin_audit_logs WHERE action = 'settings_updated'");
    expect(rows[0].details.changes.startingPoints).toEqual({ from: 1000, to: 250 });
    expect(rows[0].details.changes.game_sapre).toEqual({ from: true, to: false });
  });

  it("the starting points and referral bonus settings apply to new sign-ups", async () => {
    const a = await makeUser({ role: "admin" });
    await as(a.cookie).put("/api/admin/settings", { startingPoints: 40, referralBonus: 25 });
    const referrer = await makeUser({ balance: 0 });
    const code = (await pool.query("SELECT referral_code FROM users WHERE id = $1", [referrer.id])).rows[0].referral_code;
    const res = await request(app).post("/api/auth/register").send({ mobile: "9700000001", password: "Password123", ref: code });
    expect(res.status).toBe(201);
    const me = await request(app).get("/api/auth/me").set("Cookie", res.headers["set-cookie"]);
    expect(me.body.balance).toBe(40);
    const bonus = await pool.query("SELECT balance FROM virtual_wallets WHERE user_id = $1", [referrer.id]);
    expect(bonus.rows[0].balance).toBe(25);
  });

  it("closing registration blocks new accounts but not logins", async () => {
    const a = await makeUser({ role: "admin" });
    const player = await makeUser();
    await as(a.cookie).put("/api/admin/settings", { registrationOpen: false });
    const res = await request(app).post("/api/auth/register").send({ mobile: "9700000002", password: "Password123" });
    expect(res.status).toBe(403);
    expect((await request(app).post("/api/auth/login").send({ identifier: player.mobile, password: TEST_PASSWORD })).status).toBe(200);
    await as(a.cookie).put("/api/admin/settings", { registrationOpen: true });
    expect((await request(app).post("/api/auth/register").send({ mobile: "9700000002", password: "Password123" })).status).toBe(201);
  });

  it("a switched-off game stops opening new periods while the others continue", async () => {
    const a = await makeUser({ role: "admin" });
    await as(a.cookie).put("/api/admin/settings", { gamesEnabled: { bcone: false } });
    const t = timingForSlot(slotAt(Date.now()) + 30);
    clock.set(() => t.startsAt + 1_000);
    const engine = new GameEngine();
    await engine.tick();
    expect(engine.current.map((r) => r.game).sort()).toEqual(GAMES.filter((g) => g !== "bcone").sort());
    const state = await request(app).get("/api/game/state");
    expect(state.body.disabledGames).toEqual(["bcone"]);
    clock.set(() => t.startsAt + ROUND_DURATION_MS + 1_000);
    await engine.tick();
    expect(engine.current.some((r) => r.game === "bcone")).toBe(false);
  });
});

describe("admin user management", () => {
  it("edits a nickname and mobile number, rejects duplicates, and audits the change", async () => {
    const a = await makeUser({ role: "admin" });
    const u = await makeUser();
    const other = await makeUser({ username: "taken_name" });
    const admin = as(a.cookie);
    expect((await admin.patch(`/api/admin/users/${u.id}`, { username: "taken_name" })).status).toBe(409);
    expect((await admin.patch(`/api/admin/users/${u.id}`, { mobile: other.mobile })).status).toBe(409);
    expect((await admin.patch(`/api/admin/users/${u.id}`, { mobile: "12345" })).status).toBe(400);
    expect((await admin.patch(`/api/admin/users/${u.id}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/admin/users/${u.id}`, { username: "brand_new", mobile: "+91 98000 11122" })).status).toBe(200);
    const { rows } = await pool.query("SELECT username, mobile FROM users WHERE id = $1", [u.id]);
    expect(rows[0]).toEqual({ username: "brand_new", mobile: "9800011122" });
    expect(await auditActions()).toContain("user_updated");
    expect((await admin.patch("/api/admin/users/999999", { username: "ghost_user" })).status).toBe(404);
  });

  it("resets a player's password, signs them out, and never stores the password in the log", async () => {
    const a = await makeUser({ role: "admin" });
    const u = await makeUser();
    const admin = as(a.cookie);
    expect((await admin.post(`/api/admin/users/${u.id}/reset-password`, { password: "short" })).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${u.id}/reset-password`, { password: "BrandNewPass99" })).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", u.cookie)).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ identifier: u.mobile, password: TEST_PASSWORD })).status).toBe(401);
    expect((await request(app).post("/api/auth/login").send({ identifier: u.mobile, password: "BrandNewPass99" })).status).toBe(200);
    const log = await pool.query("SELECT details::text AS d FROM admin_audit_logs WHERE action = 'user_password_reset'");
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].d).not.toContain("BrandNewPass99");
  });

  it("does not reset admin passwords or your own from the panel", async () => {
    const a = await makeUser({ role: "admin" });
    const b = await makeUser({ role: "admin" });
    const admin = as(a.cookie);
    expect((await admin.post(`/api/admin/users/${b.id}/reset-password`, { password: "BrandNewPass99" })).body.error.code).toBe("admin_target");
    expect((await admin.post(`/api/admin/users/${a.id}/reset-password`, { password: "BrandNewPass99" })).body.error.code).toBe("use_profile");
  });

  it("can sign a player out of every device", async () => {
    const a = await makeUser({ role: "admin" });
    const u = await makeUser();
    expect((await request(app).get("/api/auth/me").set("Cookie", u.cookie)).status).toBe(200);
    const res = await as(a.cookie).post(`/api/admin/users/${u.id}/logout`);
    expect(res.body.sessionsEnded).toBe(1);
    expect((await request(app).get("/api/auth/me").set("Cookie", u.cookie)).status).toBe(401);
  });

  it("promotes and demotes admins with a reason; demoted admins lose access at once; no self-changes", async () => {
    const a = await makeUser({ role: "admin" });
    const u = await makeUser();
    const admin = as(a.cookie);
    expect((await admin.post(`/api/admin/users/${u.id}/role`, { role: "admin", reason: "x" })).status).toBe(400);
    expect((await admin.post(`/api/admin/users/${a.id}/role`, { role: "user", reason: "testing self" })).body.error.code).toBe("self_role");
    expect((await admin.post(`/api/admin/users/${u.id}/role`, { role: "admin", reason: "trusted helper" })).status).toBe(200);
    expect((await request(app).get("/api/admin/overview").set("Cookie", u.cookie)).status).toBe(200);
    expect((await admin.post(`/api/admin/users/${u.id}/role`, { role: "admin", reason: "again please" })).body.error.code).toBe("no_change");
    expect((await admin.post(`/api/admin/users/${u.id}/role`, { role: "user", reason: "no longer needed" })).status).toBe(200);
    expect((await request(app).get("/api/admin/overview").set("Cookie", u.cookie)).status).toBe(401);
    expect(await auditActions()).toEqual(expect.arrayContaining(["user_promoted_to_admin", "admin_demoted"]));
  });

  it("creates another admin account that can log in with its email", async () => {
    const a = await makeUser({ role: "admin" });
    const admin = as(a.cookie);
    expect((await admin.post("/api/admin/admins", { username: "helper1", email: "nope", password: "Password123" })).status).toBe(400);
    const res = await admin.post("/api/admin/admins", { username: "helper1", email: "Helper@Example.com", password: "Password123" });
    expect(res.status).toBe(201);
    expect((await admin.post("/api/admin/admins", { username: "helper2", email: "helper@example.com", password: "Password123" })).status).toBe(409);
    const login = await request(app).post("/api/auth/login").send({ identifier: "helper@example.com", password: "Password123" });
    expect(login.body.user.role).toBe("admin");
    const list = await admin.get("/api/admin/admins");
    expect(list.body.admins.map((x: { username: string }) => x.username)).toEqual(expect.arrayContaining(["helper1"]));
    // regular players cannot do any of this
    const u = await makeUser();
    expect((await as(u.cookie).post("/api/admin/admins", { username: "evil_admin", email: "e@x.io", password: "Password123" })).status).toBe(403);
  });

  it("lists referrals for the admin", async () => {
    const a = await makeUser({ role: "admin" });
    const referrer = await makeUser({ balance: 0 });
    const code = (await pool.query("SELECT referral_code FROM users WHERE id = $1", [referrer.id])).rows[0].referral_code;
    await request(app).post("/api/auth/register").send({ mobile: "9700000003", password: "Password123", ref: code });
    const res = await as(a.cookie).get("/api/admin/referrals");
    expect(res.body).toMatchObject({ total: 1, totalBonus: 150 });
    expect(res.body.referrals[0]).toMatchObject({ referrer_id: referrer.id, bonus: 150, referred_mobile: "9700000003" });
    const detail = await as(a.cookie).get(`/api/admin/users/${referrer.id}`);
    expect(detail.body.referral).toMatchObject({ referrals_made: 1, referral_earned: 150 });
  });
});
