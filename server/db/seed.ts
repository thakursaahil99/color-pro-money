/**
 * DEMO MODE ONLY: inserts mock players and a history of settled rounds so the
 * dashboards have data to show. Refuses to run unless DEMO_MODE=true and not in production.
 * All points are virtual and have no cash value.
 */
import crypto from "node:crypto";
import { BET_AMOUNTS, GAMES, SELECTIONS, slotAt } from "../../shared/game";
import { config } from "../config";
import { placeBet } from "../game/betting";
import { createRoundForSlot } from "../game/rounds";
import { settleRound } from "../game/settlement";
import { hashPassword } from "../lib/password";
import { migrate } from "./migrate";
import { pool, withTransaction } from "./pool";

export const DEMO_PASSWORD = "DemoPlayer123";
const DEMO_USERS = ["demo_player", "lucky_luna", "red_rider", "green_goblin", "violet_vibes", "chip_champ", "round_runner", "color_cat"];

const pick = <T,>(arr: readonly T[]) => arr[crypto.randomInt(arr.length)];

async function main() {
  if (!config.demoMode || config.isProd) {
    throw new Error("Seeding mock data is only allowed with DEMO_MODE=true outside production.");
  }
  await migrate(false);
  const hash = await hashPassword(DEMO_PASSWORD);

  const userIds: number[] = [];
  for (const [i, username] of DEMO_USERS.entries()) {
    const mobile = `90000000${String(i + 1).padStart(2, "0")}`;
    const id = await withTransaction(async (db) => {
      const found = await db.query("SELECT id FROM users WHERE username = $1", [username]);
      if (found.rows[0]) {
        await db.query("UPDATE users SET mobile = $2 WHERE id = $1 AND mobile IS NULL", [found.rows[0].id, mobile]);
        return found.rows[0].id as number;
      }
      const { rows } = await db.query(
        `INSERT INTO users (username, mobile, password_hash, is_demo, last_seen_at)
         VALUES ($1, $2, $3, TRUE, now() - make_interval(mins => $4)) RETURNING id`,
        [username, mobile, hash, crypto.randomInt(0, 120)],
      );
      const uid = rows[0].id as number;
      await db.query("INSERT INTO virtual_wallets (user_id, balance) VALUES ($1, 20000)", [uid]);
      await db.query(
        `INSERT INTO virtual_wallet_transactions (user_id, type, amount, balance_after, description)
         VALUES ($1, 'signup_bonus', 20000, 20000, 'Demo welcome bonus (virtual points)')`,
        [uid],
      );
      return uid;
    });
    userIds.push(id);
  }

  // Past rounds, played and settled through the real betting/settlement code paths.
  const current = slotAt(Date.now());
  let created = 0;
  for (let slot = current - 14; slot <= current - 2; slot++) {
    for (const game of GAMES) {
      const round = await createRoundForSlot(pool, slot, game);
      if (!round) continue;
      created++;
      for (const userId of userIds) {
        if (crypto.randomInt(100) < 40) continue;
        // mostly colour bets, sometimes a number
        const selection = crypto.randomInt(100) < 75 ? pick(SELECTIONS.slice(0, 3)) : pick(SELECTIONS.slice(3));
        await placeBet({
          userId,
          roundId: round.id,
          selection,
          amount: pick(BET_AMOUNTS.slice(0, 3)),
          nonce: crypto.randomUUID(),
          nowMs: round.starts_at.getTime() + 5_000 + crypto.randomInt(100_000),
        }).catch(() => {});
      }
      await pool.query("UPDATE game_rounds SET status = 'closed', closed_at = betting_closes_at WHERE id = $1 AND status = 'open'", [round.id]);
      await settleRound(round.id);
    }
  }

  console.log(`Demo data ready: ${userIds.length} demo players, ${created} past rounds.`);
  console.log(`Demo player login -> mobile: 9000000001  password: ${DEMO_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(`Error: ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
