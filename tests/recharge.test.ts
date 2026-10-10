import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { balanceOf, ledgerSum, makeUser, resetDb } from "./helpers";

let app = createApp({ lazyEngine: false });
beforeEach(async () => {
  await resetDb();
  app = createApp({ lazyEngine: false });
});
afterAll(() => pool.end());

const as = (cookie: string) => ({
  get: (p: string) => request(app).get(p).set("Cookie", cookie),
  post: (p: string, body: object = {}) => request(app).post(p).set("Cookie", cookie).send(body),
});
const actions = async () => (await pool.query("SELECT action FROM admin_audit_logs ORDER BY id")).rows.map((r) => r.action);

describe("free recharge requests (virtual points, admin approves)", () => {
  it("a player can ask for 100 or 500 points and sees the request as pending", async () => {
    const u = await makeUser({ balance: 0 });
    expect((await as(u.cookie).get("/api/me/recharge")).body).toMatchObject({ amounts: [100, 500], pending: null, history: [] });
    const res = await as(u.cookie).post("/api/me/recharge", { amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.request).toMatchObject({ amount: 500, status: "pending" });
    const list = await as(u.cookie).get("/api/me/recharge");
    expect(list.body.pending).toMatchObject({ amount: 500, status: "pending" });
    expect(await balanceOf(u.id)).toBe(0); // nothing is credited until an admin approves
  });

  it("only the offered amounts are accepted", async () => {
    const u = await makeUser({ balance: 0 });
    for (const amount of [0, -100, 99, 1000, 100.5, 100000, "500", null]) {
      expect((await as(u.cookie).post("/api/me/recharge", { amount })).status).toBe(400);
    }
    expect((await as(u.cookie).post("/api/me/recharge", {})).status).toBe(400);
  });

  it("only one open request per player at a time", async () => {
    const u = await makeUser({ balance: 0 });
    expect((await as(u.cookie).post("/api/me/recharge", { amount: 100 })).status).toBe(201);
    const second = await as(u.cookie).post("/api/me/recharge", { amount: 500 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("request_pending");
  });

  it("approving credits the points once, writes the ledger and the audit log", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser({ balance: 0 });
    const id = (await as(u.cookie).post("/api/me/recharge", { amount: 500 })).body.request.id;
    const res = await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(500);
    expect(await balanceOf(u.id)).toBe(500);
    expect(await ledgerSum(u.id)).toBe(500);
    const tx = await pool.query("SELECT type, amount, balance_after, request_id FROM virtual_wallet_transactions WHERE user_id = $1", [u.id]);
    expect(tx.rows).toEqual([{ type: "recharge_approved", amount: 500, balance_after: 500, request_id: id }]);
    const row = await pool.query("SELECT status, decided_by FROM points_requests WHERE id = $1", [id]);
    expect(row.rows[0]).toEqual({ status: "approved", decided_by: admin.id });
    expect(await actions()).toContain("recharge_approved");
    // approved again -> refused, no second credit
    const again = await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`);
    expect(again.status).toBe(409);
    expect(await balanceOf(u.id)).toBe(500);
    // and the player can ask again afterwards
    expect((await as(u.cookie).post("/api/me/recharge", { amount: 100 })).status).toBe(201);
  });

  it("rejecting needs a reason, adds no points, and the player sees why", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser({ balance: 0 });
    const id = (await as(u.cookie).post("/api/me/recharge", { amount: 100 })).body.request.id;
    expect((await as(admin.cookie).post(`/api/admin/recharges/${id}/reject`, { reason: "" })).status).toBe(400);
    expect((await as(admin.cookie).post(`/api/admin/recharges/${id}/reject`, { reason: "Not today" })).status).toBe(200);
    expect(await balanceOf(u.id)).toBe(0);
    const mine = await as(u.cookie).get("/api/me/recharge");
    expect(mine.body.pending).toBeNull();
    expect(mine.body.history[0]).toMatchObject({ status: "rejected", reject_reason: "Not today" });
    expect(await actions()).toContain("recharge_rejected");
    expect((await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`)).status).toBe(409);
  });

  it("simultaneous approvals credit exactly once", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser({ balance: 0 });
    const id = (await as(u.cookie).post("/api/me/recharge", { amount: 500 })).body.request.id;
    const results = await Promise.all(Array.from({ length: 6 }, () => as(admin.cookie).post(`/api/admin/recharges/${id}/approve`)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await balanceOf(u.id)).toBe(500);
    expect(await ledgerSum(u.id)).toBe(500);
  });

  it("an admin cannot approve their own request", async () => {
    const admin = await makeUser({ role: "admin", balance: 0 });
    const id = (await as(admin.cookie).post("/api/me/recharge", { amount: 100 })).body.request.id;
    const res = await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`);
    expect(res.body.error.code).toBe("self_request");
    expect(await balanceOf(admin.id)).toBe(0);
  });

  it("players cannot approve, reject or list requests; anonymous users get nothing", async () => {
    const u = await makeUser({ balance: 0 });
    const other = await makeUser({ balance: 0 });
    const id = (await as(u.cookie).post("/api/me/recharge", { amount: 500 })).body.request.id;
    expect((await as(other.cookie).post(`/api/admin/recharges/${id}/approve`)).status).toBe(403);
    expect((await as(other.cookie).post(`/api/admin/recharges/${id}/reject`, { reason: "nope" })).status).toBe(403);
    expect((await as(other.cookie).get("/api/admin/recharges")).status).toBe(403);
    expect((await as(u.cookie).post(`/api/admin/recharges/${id}/approve`)).status).toBe(403);
    expect((await request(app).get("/api/me/recharge")).status).toBe(401);
    expect((await request(app).post("/api/me/recharge").send({ amount: 100 })).status).toBe(401);
    expect(await balanceOf(u.id)).toBe(0);
  });

  it("a player only ever sees their own requests", async () => {
    const a = await makeUser({ balance: 0 });
    const b = await makeUser({ balance: 0 });
    await as(a.cookie).post("/api/me/recharge", { amount: 100 });
    const res = await as(b.cookie).get("/api/me/recharge");
    expect(res.body.history).toEqual([]);
    expect(res.body.pending).toBeNull();
  });

  it("the admin list shows requests with pending first and can filter by status", async () => {
    const admin = await makeUser({ role: "admin" });
    const a = await makeUser({ balance: 0 });
    const b = await makeUser({ balance: 0 });
    const idA = (await as(a.cookie).post("/api/me/recharge", { amount: 100 })).body.request.id;
    await as(b.cookie).post("/api/me/recharge", { amount: 500 });
    await as(admin.cookie).post(`/api/admin/recharges/${idA}/approve`);
    const all = await as(admin.cookie).get("/api/admin/recharges");
    expect(all.body.total).toBe(2);
    expect(all.body.pending).toBe(1);
    expect(all.body.requests[0]).toMatchObject({ status: "pending", amount: 500, user_id: b.id });
    const pendingOnly = await as(admin.cookie).get("/api/admin/recharges?status=pending");
    expect(pendingOnly.body.requests).toHaveLength(1);
    expect((await as(admin.cookie).get("/api/admin/overview")).body.stats.pending_recharges).toBe(1);
  });

  it("decided requests cannot be changed or deleted, even directly in the database", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser({ balance: 0 });
    const id = (await as(u.cookie).post("/api/me/recharge", { amount: 100 })).body.request.id;
    await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`);
    await expect(pool.query("UPDATE points_requests SET amount = 500 WHERE id = $1", [id])).rejects.toThrow(/final/);
    await expect(pool.query("DELETE FROM points_requests")).rejects.toThrow(/not allowed/);
  });

  it("involves no payment: UPI ids, transaction ids and amounts sent by the client are ignored", async () => {
    const admin = await makeUser({ role: "admin" });
    const u = await makeUser({ balance: 0 });
    const res = await as(u.cookie).post("/api/me/recharge", { amount: 100, upi: "x@upi", transactionId: "T123456789", credit: 999999 });
    expect(res.status).toBe(201);
    expect(res.body.request.amount).toBe(100);
    const id = res.body.request.id;
    expect((await as(admin.cookie).post(`/api/admin/recharges/${id}/approve`, { amount: 100000 })).body.balance).toBe(100);
    for (const path of ["/api/me/deposit", "/api/me/payment", "/api/me/withdraw"]) {
      expect((await as(u.cookie).post(path, { amount: 100 })).status).toBe(404);
    }
  });
});
