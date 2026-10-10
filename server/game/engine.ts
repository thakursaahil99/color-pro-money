import { GAMES, slotAt, timingForSlot, type PublicResult, type PublicRound, type ServerMessage } from "../../shared/game";
import { pool } from "../db/pool";
import { getSettings } from "../lib/settings";
import { clock } from "./clock";
import { createRoundForSlot, getCurrentRounds, getRecentResults, isPaused, toPublicRound } from "./rounds";
import { settleRound } from "./settlement";

/** A round is only opened mid-slot if at least this much betting time is left. */
export const MIN_BETTING_TIME_TO_OPEN_MS = 15_000;
const TICK_BROADCAST_EVERY_MS = 5_000;
const RECENT_PER_GAME = 20;

export type Broadcast = (msg: ServerMessage) => void;

/**
 * Drives the round lifecycle of every game on the server clock:
 *   open (betting) -> closed (locked, last 30s) -> settled (result revealed)
 * Every step is idempotent and guarded by row locks, so a restart or a second
 * instance can never settle a round twice.
 */
export class GameEngine {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastTickBroadcast = 0;
  current: PublicRound[] = [];
  paused = false;
  /** games the admin has switched off */
  disabled: PublicRound["game"][] = [];
  recent: PublicResult[] = [];

  constructor(private broadcast: Broadcast = () => {}) {}

  async start() {
    this.recent = await getRecentResults(pool, RECENT_PER_GAME);
    await this.tick();
    this.timer = setInterval(() => void this.tick(), 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  helloMessage(): ServerMessage {
    return { type: "hello", serverTime: clock.now(), rounds: this.current, paused: this.paused, recent: this.recent };
  }

  /** The current round of one game, if any. */
  roundOf(game: string): PublicRound | undefined {
    return this.current.find((r) => r.game === game);
  }

  /** One pass of the state machine. Safe to call at any time. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = clock.now();
      this.paused = await isPaused(pool);
      const settings = await getSettings(pool);
      this.disabled = GAMES.filter((g) => !settings.gamesEnabled[g]);

      // 1. Settle every round whose end time has passed (including ones missed during downtime).
      const due = await pool.query<{ id: number }>(
        "SELECT id FROM game_rounds WHERE status <> 'settled' AND ends_at <= to_timestamp($1 / 1000.0) ORDER BY ends_at, id",
        [now],
      );
      for (const { id } of due.rows) {
        const outcome = await settleRound(id);
        if (outcome) {
          const result: PublicResult = {
            roundId: outcome.roundId,
            game: outcome.game,
            code: outcome.code,
            number: outcome.number,
            price: outcome.price,
            settledAt: outcome.settledAt,
          };
          this.recent = [result, ...this.recent];
          const perGame = new Map<string, number>();
          this.recent = this.recent.filter((r) => {
            const n = (perGame.get(r.game) ?? 0) + 1;
            perGame.set(r.game, n);
            return n <= RECENT_PER_GAME;
          });
          this.broadcast({ type: "round:result", serverTime: clock.now(), result, serverSeed: outcome.serverSeed });
        }
      }

      // 2. Close betting on rounds that reached their lock time.
      const closed = await pool.query<{ id: number; game: PublicRound["game"] }>(
        `UPDATE game_rounds SET status = 'closed', closed_at = now()
          WHERE status = 'open' AND betting_closes_at <= to_timestamp($1 / 1000.0) RETURNING id, game`,
        [now],
      );
      for (const { id, game } of closed.rows) this.broadcast({ type: "round:closed", serverTime: clock.now(), roundId: id, game });

      // 3. Open the round of every game for the current slot unless rounds are paused for maintenance.
      if (!this.paused) {
        const t = timingForSlot(slotAt(now));
        if (t.bettingClosesAt - now >= MIN_BETTING_TIME_TO_OPEN_MS) {
          for (const game of GAMES) {
            if (!settings.gamesEnabled[game]) continue;
            const created = await createRoundForSlot(pool, t.slot, game);
            if (created) this.broadcast({ type: "round:new", serverTime: clock.now(), round: toPublicRound(created) });
          }
        }
      }

      this.current = (await getCurrentRounds(pool, now)).map(toPublicRound);

      if (now - this.lastTickBroadcast >= TICK_BROADCAST_EVERY_MS) {
        this.lastTickBroadcast = now;
        this.broadcast({ type: "tick", serverTime: clock.now(), rounds: this.current, paused: this.paused });
      }
    } catch (err) {
      console.error("engine tick failed", err);
    } finally {
      this.running = false;
    }
  }
}
