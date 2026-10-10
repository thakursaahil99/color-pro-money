import type { PoolClient } from "pg";
import { timingForSlot, type Game, type PublicResult, type PublicRound } from "../../shared/game";
import type { Db } from "../db/pool";
import { hashSeed, newServerSeed } from "../lib/rng";

export interface RoundRow {
  id: number;
  game: Game;
  slot: number;
  code: string;
  status: "open" | "closed" | "settled";
  starts_at: Date;
  betting_closes_at: Date;
  ends_at: Date;
  server_seed: string;
  server_seed_hash: string;
  settled_at: Date | null;
}

/** The public view of a round. The server seed is deliberately never included. */
export function toPublicRound(r: RoundRow): PublicRound {
  return {
    id: r.id,
    game: r.game,
    code: r.code,
    status: r.status,
    startsAt: r.starts_at.getTime(),
    bettingClosesAt: r.betting_closes_at.getTime(),
    endsAt: r.ends_at.getTime(),
    commitHash: r.server_seed_hash,
  };
}

export async function isPaused(db: Db): Promise<boolean> {
  const { rows } = await db.query("SELECT value FROM system_settings WHERE key = 'rounds_paused'");
  return rows[0]?.value === true;
}

export async function setPaused(db: PoolClient, paused: boolean, adminId: number | null) {
  await db.query(
    `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ('rounds_paused', $1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [JSON.stringify(paused), adminId],
  );
}

/** Creates the round of one game for a slot if it does not exist yet. Returns the row only if newly created. */
export async function createRoundForSlot(db: Db, slot: number, game: Game = "parity"): Promise<RoundRow | null> {
  // Cheap existence check first so the engine's 1s ticks don't burn sequence values.
  const existing = await db.query("SELECT 1 FROM game_rounds WHERE game = $1 AND slot = $2", [game, slot]);
  if (existing.rowCount) return null;
  const t = timingForSlot(slot);
  const seed = newServerSeed();
  const { rows } = await db.query<RoundRow>(
    `INSERT INTO game_rounds (game, slot, code, status, starts_at, betting_closes_at, ends_at, server_seed, server_seed_hash)
     VALUES ($1, $2, $3, 'open', to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0), to_timestamp($6 / 1000.0), $7, $8)
     ON CONFLICT (game, slot) DO NOTHING
     RETURNING *`,
    [game, slot, t.code, t.startsAt, t.bettingClosesAt, t.endsAt, seed, hashSeed(seed)],
  );
  return rows[0] ?? null;
}

/** Every game's round that covers the given instant. */
export async function getCurrentRounds(db: Db, nowMs: number): Promise<RoundRow[]> {
  const { rows } = await db.query<RoundRow>(
    `SELECT * FROM game_rounds
      WHERE starts_at <= to_timestamp($1 / 1000.0) AND ends_at > to_timestamp($1 / 1000.0)
      ORDER BY game, starts_at DESC`,
    [nowMs],
  );
  // If a game has two overlapping rows (legacy data), keep the newest.
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.game) ? false : (seen.add(r.game), true)));
}

/** The latest `perGame` settled results of every game, newest first. */
export async function getRecentResults(db: Db, perGame = 20): Promise<PublicResult[]> {
  const { rows } = await db.query<{ round_id: number; game: Game; code: string; number: number; price: number; created_at: Date }>(
    `SELECT round_id, game, code, number, price, created_at FROM (
       SELECT gr.round_id, r.game, r.code, gr.number, gr.price, gr.created_at,
              row_number() OVER (PARTITION BY r.game ORDER BY r.starts_at DESC) AS rn
         FROM game_results gr JOIN game_rounds r ON r.id = gr.round_id
     ) t WHERE rn <= $1 ORDER BY created_at DESC`,
    [perGame],
  );
  return rows.map((r) => ({
    roundId: r.round_id,
    game: r.game,
    code: r.code,
    number: r.number,
    price: r.price,
    settledAt: r.created_at.getTime(),
  }));
}
