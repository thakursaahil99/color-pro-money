import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { BETTING_WINDOW_MS, GAMES, ROUND_DURATION_MS, slotAt, timingForSlot, type ServerMessage } from "../shared/game";
import { createApp } from "../server/app";
import { pool } from "../server/db/pool";
import { clock } from "../server/game/clock";
import { GameEngine } from "../server/game/engine";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => pool.end());

function setup() {
  const messages: ServerMessage[] = [];
  const engine = new GameEngine((m) => messages.push(m));
  const t = timingForSlot(slotAt(Date.now()) + 10);
  const at = (offset: number) => clock.set(() => t.startsAt + offset);
  return { engine, messages, t, at };
}

describe("game engine lifecycle", () => {
  it("opens, closes and settles every game's round on the server clock", async () => {
    const { engine, messages, t, at } = setup();

    at(0);
    await engine.tick();
    expect(engine.current).toHaveLength(GAMES.length);
    for (const game of GAMES) {
      expect(engine.roundOf(game)?.code).toBe(t.code);
      expect(engine.roundOf(game)?.status).toBe("open");
    }
    expect(messages.filter((m) => m.type === "round:new")).toHaveLength(GAMES.length);

    at(BETTING_WINDOW_MS);
    await engine.tick();
    for (const game of GAMES) expect(engine.roundOf(game)?.status).toBe("closed");
    expect(messages.filter((m) => m.type === "round:closed")).toHaveLength(GAMES.length);

    at(ROUND_DURATION_MS);
    await engine.tick();
    const results = messages.filter((m) => m.type === "round:result");
    expect(results).toHaveLength(GAMES.length);
    const { rows } = await pool.query("SELECT status FROM game_rounds WHERE code = $1", [t.code]);
    expect(rows.every((r) => r.status === "settled")).toBe(true);
    // the next period opened immediately for every game
    for (const game of GAMES) expect(engine.roundOf(game)?.code).toBe(timingForSlot(t.slot + 1).code);
  });

  it("each result is a number 0-9 whose price ends in that number", async () => {
    const { engine, messages, at } = setup();
    at(0);
    await engine.tick();
    at(ROUND_DURATION_MS);
    await engine.tick();
    for (const m of messages) {
      if (m.type !== "round:result") continue;
      expect(m.result.number).toBeGreaterThanOrEqual(0);
      expect(m.result.number).toBeLessThanOrEqual(9);
      expect(m.result.price % 10).toBe(m.result.number);
    }
  });

  it("does not open new rounds while paused, but finishes the active ones", async () => {
    const { engine, t, at } = setup();
    at(0);
    await engine.tick();
    await pool.query("UPDATE system_settings SET value = 'true' WHERE key = 'rounds_paused'");
    at(ROUND_DURATION_MS + 1000);
    await engine.tick();
    const { rows } = await pool.query("SELECT game, code, status FROM game_rounds ORDER BY game");
    expect(rows).toEqual([...GAMES].sort().map((game) => ({ game, code: t.code, status: "settled" })));
    expect(engine.current).toHaveLength(0);
    expect(engine.paused).toBe(true);
  });

  it("does not open a round mid-slot when too little betting time is left", async () => {
    const { engine, at } = setup();
    at(BETTING_WINDOW_MS - 5_000);
    await engine.tick();
    expect(engine.current).toHaveLength(0);
  });

  it("settles rounds missed while the server was down", async () => {
    const { engine, t, at } = setup();
    at(0);
    await engine.tick();
    at(ROUND_DURATION_MS * 5 + 1_000); // server "comes back" several rounds later
    await engine.tick();
    const { rows } = await pool.query("SELECT status FROM game_rounds WHERE code = $1", [t.code]);
    expect(rows).toHaveLength(GAMES.length);
    expect(rows.every((r) => r.status === "settled")).toBe(true);
  });

  it("the state API reports server time so every client shares one countdown", async () => {
    const { engine, t, at } = setup();
    at(42_000);
    await engine.tick();
    const res = await request(createApp()).get("/api/game/state");
    expect(res.body.serverTime).toBe(t.startsAt + 42_000);
    expect(res.body.rounds).toHaveLength(GAMES.length);
    for (const round of res.body.rounds) {
      expect(round.endsAt).toBe(t.endsAt);
      expect(round.bettingClosesAt).toBe(t.bettingClosesAt);
      expect(round).not.toHaveProperty("serverSeed");
    }
    expect(JSON.stringify(res.body)).not.toContain("server_seed");
  });
});
