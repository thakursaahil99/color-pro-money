import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { TEST_PASSWORD, makeUser, openRoundAt, resetDb } from "./helpers";

let app = createApp();
beforeEach(async () => {
  await resetDb();
  app = createApp(); // fresh rate-limit buckets per test
});
afterAll(() => pool.end());

const ADMIN_GETS = ["/api/admin/overview", "/api/admin/analytics/colors", "/api/admin/bets", "/api/admin/rounds", "/api/admin/users", "/api/admin/audit", "/api/admin/suspicious"];

describe("access control", () => {
  it("anonymous visitors cannot reach user or admin APIs", async () => {
    expect((await request(app).get("/api/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/me/bets")).status).toBe(401);
    for (const path of ADMIN_GETS) expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).post("/api/game/bets").send({})).status).toBe(401);
  });

  it("regular users are forbidden from every admin API", async () => {
    const u = await makeUser();
    for (const path of ADMIN_GETS) expect((await request(app).get(path).set("Cookie", u.cookie)).status).toBe(403);
    const pause = await request(app).post("/api/admin/rounds/pause").set("Cookie", u.cookie).send({ paused: true, reason: "nope" });
    expect(pause.status).toBe(403);
  });

  it("admins can reach admin APIs", async () => {
    const a = await makeUser({ role: "admin" });
    for (const path of ADMIN_GETS) expect((await request(app).get(path).set("Cookie", a.cookie)).status).toBe(200);
  });

  it("there is no API to set or change a result", async () => {
    const a = await makeUser({ role: "admin" });
    const round = await openRoundAt(1_000);
    for (const path of [`/api/admin/rounds/${round.id}/result`, `/api/admin/rounds/${round.id}`, "/api/admin/results"]) {
      for (const method of ["post", "put", "patch"] as const) {
        const res = await request(app)[method](path).set("Cookie", a.cookie).send({ color: "red" });
        expect(res.status).toBe(404);
      }
    }
  });

  it("rejects forged session cookies", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", `cpm_session=${crypto.randomBytes(32).toString("base64url")}`);
    expect(res.status).toBe(401);
  });

  it("blocks cross-site state-changing requests", async () => {
    const u = await makeUser();
    const res = await request(app).post("/api/auth/logout").set("Cookie", u.cookie).set("Origin", "https://evil.example").send({});
    expect(res.status).toBe(403);
    const form = await request(app).post("/api/auth/logout").set("Cookie", u.cookie).type("form").send("a=1");
    expect(form.status).toBe(403);
  });

  it("does not expose other players' private data in public endpoints", async () => {
    const sam = await makeUser({ username: "secret_sam" });
    const state = await request(app).get("/api/game/state");
    const results = await request(app).get("/api/game/results");
    for (const body of [state.text, results.text]) {
      expect(body).not.toContain("secret_sam");
      expect(body).not.toContain(sam.mobile);
      expect(body).not.toContain("password");
    }
  });
});

describe("authentication", () => {
  it("registers with a mobile number, a hashed password and starting virtual points", async () => {
    const res = await request(app).post("/api/auth/register").send({ mobile: "+91 98765-43210", password: "Password123", username: "newbie" });
    expect(res.status).toBe(201);
    expect(res.headers["set-cookie"][0]).toMatch(/HttpOnly/i);
    const { rows } = await pool.query("SELECT password_hash, mobile FROM users WHERE username = 'newbie'");
    expect(rows[0].mobile).toBe("9876543210");
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(rows[0].password_hash).not.toContain("Password123");
    const me = await request(app).get("/api/auth/me").set("Cookie", res.headers["set-cookie"]);
    expect(me.body.balance).toBe(1000);
    // same number in another format is still a duplicate
    const dup = await request(app).post("/api/auth/register").send({ mobile: "09876543210", password: "Password123" });
    expect(dup.status).toBe(409);
    // log in with the mobile number
    const login = await request(app).post("/api/auth/login").send({ identifier: "9876543210", password: "Password123" });
    expect(login.status).toBe(200);
  });

  it("rejects invalid mobile numbers and auto-generates a nickname", async () => {
    for (const mobile of ["12345", "1234567890", "98765abcde", "+1 415 555 0100"]) {
      expect((await request(app).post("/api/auth/register").send({ mobile, password: "Password123" })).status).toBe(400);
    }
    const ok = await request(app).post("/api/auth/register").send({ mobile: "7012345678", password: "Password123" });
    expect(ok.status).toBe(201);
    expect(ok.body.user.username).toMatch(/^Member\d{6}$/);
  });

  it("rejects weak passwords and wrong credentials", async () => {
    expect((await request(app).post("/api/auth/register").send({ mobile: "9123456789", password: "short" })).status).toBe(400);
    const u = await makeUser();
    const bad = await request(app).post("/api/auth/login").send({ identifier: u.mobile, password: "WrongPass999" });
    expect(bad.status).toBe(401);
    const good = await request(app).post("/api/auth/login").send({ identifier: u.mobile, password: TEST_PASSWORD });
    expect(good.status).toBe(200);
  });

  it("an admin can log in with their email address", async () => {
    const admin = await makeUser({ role: "admin", username: "boss" });
    await pool.query("UPDATE users SET email = 'boss@example.com' WHERE id = $1", [admin.id]);
    const res = await request(app).post("/api/auth/login").send({ identifier: "Boss@Example.com", password: TEST_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("admin");
  });

  it("rate-limits login attempts", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await request(app).post("/api/auth/login").send({ identifier: "nobody", password: "x" })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[11]).toBe(429);
  });
});

describe("admin actions and audit trail", () => {
  it("suspending a user requires a reason, revokes sessions, blocks login and is audited", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser();
    const noReason = await request(app).post(`/api/admin/users/${u.id}/suspend`).set("Cookie", admin.cookie).send({ reason: "" });
    expect(noReason.status).toBe(400);

    const ok = await request(app).post(`/api/admin/users/${u.id}/suspend`).set("Cookie", admin.cookie).send({ reason: "Multiple accounts" });
    expect(ok.status).toBe(200);
    expect((await request(app).get("/api/auth/me").set("Cookie", u.cookie)).status).toBe(401);
    const login = await request(app).post("/api/auth/login").send({ identifier: u.username, password: TEST_PASSWORD });
    expect(login.status).toBe(403);

    const { rows } = await pool.query("SELECT action, admin_user_id, details FROM admin_audit_logs WHERE action = 'user_suspended'");
    expect(rows).toHaveLength(1);
    expect(rows[0].admin_user_id).toBe(admin.id);
    expect(rows[0].details.reason).toBe("Multiple accounts");
  });

  it("pausing rounds is audited and the audit chain verifies", async () => {
    const admin = await makeUser({ role: "admin" });
    await request(app).post("/api/admin/rounds/pause").set("Cookie", admin.cookie).send({ paused: true, reason: "maintenance" }).expect(200);
    await request(app).post("/api/admin/rounds/pause").set("Cookie", admin.cookie).send({ paused: false, reason: "done" }).expect(200);
    const verify = await request(app).get("/api/admin/audit/verify").set("Cookie", admin.cookie);
    expect(verify.body).toMatchObject({ entries: 2, broken: 0, valid: true });
  });

  it("audit logs are append-only", async () => {
    const admin = await makeUser({ role: "admin" });
    await request(app).post("/api/admin/rounds/pause").set("Cookie", admin.cookie).send({ paused: true, reason: "maintenance" });
    await expect(pool.query("UPDATE admin_audit_logs SET action = 'nothing'")).rejects.toThrow(/not allowed/);
    await expect(pool.query("DELETE FROM admin_audit_logs")).rejects.toThrow(/not allowed/);
  });

  it("admins cannot suspend themselves or other admins", async () => {
    const a = await makeUser({ role: "admin" });
    const b = await makeUser({ role: "admin" });
    expect((await request(app).post(`/api/admin/users/${a.id}/suspend`).set("Cookie", a.cookie).send({ reason: "testing self" })).status).toBe(400);
    expect((await request(app).post(`/api/admin/users/${b.id}/suspend`).set("Cookie", a.cookie).send({ reason: "testing other" })).status).toBe(400);
  });
});
