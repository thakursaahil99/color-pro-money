import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BETTING_WINDOW_MS, GAMES, ROUND_DURATION_MS } from "../shared/game";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { placeBet } from "../server/game/betting";
import { flushSecurityEvents } from "../server/lib/security";
import { clock } from "../server/game/clock";
import { balanceOf, ledgerSum, makeUser, openRoundAt, resetDb } from "./helpers";

let app = createApp();
const bet = (cookie: string, body: Record<string, unknown>) =>
  request(app).post("/api/game/bets").set("Cookie", cookie).send({ nonce: crypto.randomUUID(), ...body });

beforeEach(async () => {
  await resetDb();
  app = createApp(); // fresh rate-limit buckets (user ids restart after every reset)
});
afterAll(() => pool.end());

describe("betting deadlines", () => {
  it("accepts a bet inside the betting window and deducts points", async () => {
    const u = await makeUser({ balance: 1000 });
    const round = await openRoundAt(10_000);
    const res = await bet(u.cookie, { roundId: round.id, selection: "red", amount: 100 });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(900);
    expect(await balanceOf(u.id)).toBe(900);
    expect(await ledgerSum(u.id)).toBe(900);
  });

  it("accepts a bet 1ms before betting closes", async () => {
    const u = await makeUser();
    const round = await openRoundAt(BETTING_WINDOW_MS - 1);
    expect((await bet(u.cookie, { roundId: round.id, selection: "green", amount: 10 })).status).toBe(201);
  });

  it("rejects a bet exactly when betting closes", async () => {
    const u = await makeUser();
    const round = await openRoundAt(BETTING_WINDOW_MS);
    const res = await bet(u.cookie, { roundId: round.id, selection: "green", amount: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("betting_closed");
    expect(await balanceOf(u.id)).toBe(1000);
  });

  it("rejects late submissions after the round ended", async () => {
    const u = await makeUser();
    const round = await openRoundAt(ROUND_DURATION_MS + 5_000);
    const res = await bet(u.cookie, { roundId: round.id, selection: "violet", amount: 10 });
    expect(res.body.error.code).toBe("betting_closed");
  });

  it("rejects bets on a round the engine has already closed, even if the clock says open", async () => {
    const u = await makeUser();
    const round = await openRoundAt(5_000);
    await pool.query("UPDATE game_rounds SET status = 'closed' WHERE id = $1", [round.id]);
    expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10 })).body.error.code).toBe("betting_closed");
  });

  it("rejects bets on rounds that have not started yet", async () => {
    const u = await makeUser();
    const round = await openRoundAt(0);
    clock.set(() => round.starts_at.getTime() - 1);
    expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10 })).body.error.code).toBe("round_not_started");
  });

  it("records late bets as security events", async () => {
    const u = await makeUser();
    const round = await openRoundAt(BETTING_WINDOW_MS + 1);
    await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10 });
    await flushSecurityEvents();
    const { rows } = await pool.query("SELECT type FROM security_events WHERE user_id = $1", [u.id]);
    expect(rows.map((r) => r.type)).toContain("late_bet");
  });
});

describe("bet validation and duplicates", () => {
  it("accepts bets on any colour or number 0-9", async () => {
    const round = await openRoundAt(1_000);
    for (const selection of ["green", "violet", "red", "0", "5", "9"]) {
      const u = await makeUser();
      const res = await bet(u.cookie, { roundId: round.id, selection, amount: 10 });
      expect(res.status).toBe(201);
      expect(res.body.bet.selection).toBe(selection);
    }
  });

  it("allows one bet per player in each of the four games at the same time", async () => {
    const u = await makeUser({ balance: 1000 });
    const rounds = [];
    for (const game of GAMES) rounds.push(await openRoundAt(1_000, undefined, game));
    for (const r of rounds) expect((await bet(u.cookie, { roundId: r.id, selection: "red", amount: 10 })).status).toBe(201);
    expect(await balanceOf(u.id)).toBe(960);
    // but not a second bet in the same game
    expect((await bet(u.cookie, { roundId: rounds[0].id, selection: "green", amount: 10 })).body.error.code).toBe("duplicate_bet");
  });

  it("only allows 10, 50, 100, 500 or 1000 points and a colour or number 0-9", async () => {
    const u = await makeUser();
    const round = await openRoundAt(1_000);
    for (const amount of [0, -10, 20, 999, 10.5, 5000]) {
      expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount })).status).toBe(400);
    }
    for (const selection of ["blue", "10", "-1", "RED", ""]) {
      expect((await bet(u.cookie, { roundId: round.id, selection, amount: 10 })).status).toBe(400);
    }
    expect(await balanceOf(u.id)).toBe(1000);
  });

  it("ignores any client-supplied balance or timestamp", async () => {
    const u = await makeUser({ balance: 50 });
    const round = await openRoundAt(1_000);
    const res = await bet(u.cookie, { roundId: round.id, selection: "red", amount: 100, balance: 999999, serverTime: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("insufficient_points");
    expect(await balanceOf(u.id)).toBe(50);
  });

  it("rejects a second bet in the same round", async () => {
    const u = await makeUser();
    const round = await openRoundAt(1_000);
    expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10 })).status).toBe(201);
    const second = await bet(u.cookie, { roundId: round.id, selection: "green", amount: 10 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("duplicate_bet");
    expect(await balanceOf(u.id)).toBe(990);
  });

  it("rejects a replayed request (same nonce)", async () => {
    const u = await makeUser();
    const round = await openRoundAt(1_000);
    const nonce = crypto.randomUUID();
    expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10, nonce })).status).toBe(201);
    const replay = await bet(u.cookie, { roundId: round.id, selection: "red", amount: 10, nonce });
    expect(replay.status).toBe(409);
    expect(["replayed_request", "duplicate_bet"]).toContain(replay.body.error.code);
    expect(await balanceOf(u.id)).toBe(990);
  });

  it("handles concurrent submissions: exactly one bet and one deduction", async () => {
    const u = await makeUser({ balance: 1000 });
    const round = await openRoundAt(1_000);
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        placeBet({ userId: u.id, roundId: round.id, selection: "red", amount: 100, nonce: crypto.randomUUID(), nowMs: clock.now() }),
      ),
    );
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(await balanceOf(u.id)).toBe(900);
    expect(await ledgerSum(u.id)).toBe(900);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM bets WHERE user_id = $1", [u.id]);
    expect(rows[0].n).toBe(1);
  });

  it("never lets a balance go negative", async () => {
    const u = await makeUser({ balance: 10 });
    const round = await openRoundAt(1_000);
    expect((await bet(u.cookie, { roundId: round.id, selection: "red", amount: 50 })).body.error.code).toBe("insufficient_points");
    await expect(pool.query("UPDATE virtual_wallets SET balance = -1 WHERE user_id = $1", [u.id])).rejects.toThrow();
  });
});
