import type { PoolClient } from "pg";
import { GAMES, type Game } from "../../shared/game";
import { config } from "../config";
import { pool, type Db } from "../db/pool";

/** Admin-editable settings. Anything the admin has not changed falls back to the environment defaults. */
export interface Settings {
  /** Virtual points a new account starts with. */
  startingPoints: number;
  /** Virtual points a referrer receives per friend who registers with their code. */
  referralBonus: number;
  /** When false, nobody can create a new account. */
  registrationOpen: boolean;
  /** Per-game switch. A disabled game finishes its running period and then stops opening new ones. */
  gamesEnabled: Record<Game, boolean>;
}

const KEYS = {
  startingPoints: "starting_points",
  referralBonus: "referral_bonus",
  registrationOpen: "registration_open",
  gamesEnabled: "games_enabled",
} as const;

export function defaultSettings(): Settings {
  return {
    startingPoints: config.startingPoints,
    referralBonus: config.referralBonus,
    registrationOpen: true,
    gamesEnabled: Object.fromEntries(GAMES.map((g) => [g, true])) as Record<Game, boolean>,
  };
}

export async function getSettings(db: Db = pool): Promise<Settings> {
  const { rows } = await db.query<{ key: string; value: unknown }>("SELECT key, value FROM system_settings WHERE key = ANY($1::text[])", [
    Object.values(KEYS),
  ]);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const s = defaultSettings();
  const sp = map.get(KEYS.startingPoints);
  if (typeof sp === "number") s.startingPoints = sp;
  const rb = map.get(KEYS.referralBonus);
  if (typeof rb === "number") s.referralBonus = rb;
  const ro = map.get(KEYS.registrationOpen);
  if (typeof ro === "boolean") s.registrationOpen = ro;
  const ge = map.get(KEYS.gamesEnabled);
  if (ge && typeof ge === "object") {
    for (const g of GAMES) if (typeof (ge as Record<string, unknown>)[g] === "boolean") s.gamesEnabled[g] = (ge as Record<string, boolean>)[g];
  }
  return s;
}

/** Saves the given fields. Returns the settings as they were before, so the caller can audit the change. */
export async function saveSettings(db: PoolClient, patch: Partial<Settings>, adminId: number): Promise<{ before: Settings; after: Settings }> {
  const before = await getSettings(db);
  const after: Settings = { ...before, ...patch, gamesEnabled: { ...before.gamesEnabled, ...(patch.gamesEnabled ?? {}) } };
  const entries: [string, unknown][] = [
    [KEYS.startingPoints, after.startingPoints],
    [KEYS.referralBonus, after.referralBonus],
    [KEYS.registrationOpen, after.registrationOpen],
    [KEYS.gamesEnabled, after.gamesEnabled],
  ];
  for (const [key, value] of entries) {
    await db.query(
      `INSERT INTO system_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), adminId],
    );
  }
  return { before, after };
}
