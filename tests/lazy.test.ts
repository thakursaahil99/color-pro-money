import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { GAMES, ROUND_DURATION_MS, slotAt, timingForSlot } from "../shared/game";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { clock } from "../server/game/clock";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => pool.end());

/** Serverless mode: no timer at all; requests advance the game. */
describe("serverless (lazy) engine", () => {
  const t = timingForSlot(slotAt(Date.now()) + 20);
  const at = (offset: number) => clock.set(() => t.startsAt + offset);
  const makeApp = () => createApp({ lazyEngine: true, lazyMinIntervalMs: 0 });

  it("opens the four rounds when the first visitor asks for the state", async () => {
    const app = makeApp();
    at(10_000);
    const res = await request(app).get("/api/game/state");
    expect(res.status).toBe(200);
    expect(res.body.rounds.map((r: { game: string }) => r.game).sort()).toEqual([...GAMES].sort());
    expect(res.body.rounds.every((r: { code: string }) => r.code === t.code)).toBe(true);
  });

  it("settles finished rounds and opens the next period on the next request", async () => {
    const app = makeApp();
    at(5_000);
    await request(app).get("/api/game/state");
    at(ROUND_DURATION_MS + 2_000);
    const res = await request(app).get("/api/game/state");
    expect(res.body.recent).toHaveLength(GAMES.length);
    for (const r of res.body.recent) expect(r.number).toBeGreaterThanOrEqual(0);
    expect(res.body.rounds.every((x: { code: string }) => x.code === timingForSlot(t.slot + 1).code)).toBe(true);
  });

  it("catches up after nobody visited for a long time", async () => {
    const app = makeApp();
    at(5_000);
    await request(app).get("/api/game/state");
    at(ROUND_DURATION_MS * 30);
    const res = await request(app).get("/api/game/state");
    expect(res.body.recent).toHaveLength(GAMES.length); // the old period settled
    expect(res.body.rounds).toHaveLength(GAMES.length); // and the current one is open
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM game_rounds WHERE status <> 'settled'");
    expect(rows[0].n).toBe(GAMES.length);
  });

  it("two function instances running at the same time never settle a round twice", async () => {
    const a = makeApp();
    const b = makeApp();
    at(5_000);
    await request(a).get("/api/game/state");
    at(ROUND_DURATION_MS + 1_000);
    await Promise.all([request(a).get("/api/game/state"), request(b).get("/api/game/state"), request(a).get("/api/game/state"), request(b).get("/api/game/state")]);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM game_results");
    expect(rows[0].n).toBe(GAMES.length);
    const audit = await pool.query("SELECT COUNT(*)::int AS n FROM admin_audit_logs WHERE action = 'round_settled'");
    expect(audit.rows[0].n).toBe(GAMES.length);
  });

  it("the health check does not touch the game", async () => {
    const app = makeApp();
    at(5_000);
    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await pool.query("SELECT COUNT(*)::int AS n FROM game_rounds")).rows[0].n).toBe(0);
  });
});
