// Game rules shared by the server and the UI.
// Everything in ColorProMoney uses VIRTUAL POINTS with no cash value.

/** Four independent games run in parallel on the same 3-minute schedule. */
export const GAMES = ["parity", "sapre", "bcone", "emerd"] as const;
export type Game = (typeof GAMES)[number];
export const GAME_LABELS: Record<Game, string> = { parity: "Parity", sapre: "Sapre", bcone: "Bcone", emerd: "Emerd" };

export const COLORS = ["green", "violet", "red"] as const;
export type Color = (typeof COLORS)[number];

export const NUMBERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** A bet is on a colour or on a single number "0"-"9". */
export const SELECTIONS = [...COLORS, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export type Selection = (typeof SELECTIONS)[number];

export const BET_AMOUNTS = [10, 50, 100, 500, 1000] as const;
export type BetAmount = (typeof BET_AMOUNTS)[number];

/** Every round lasts exactly 180 seconds. */
export const ROUND_DURATION_MS = 180_000;
/** Betting closes this long before the round ends (the "lock" period). */
export const BETTING_LOCK_MS = 30_000;
/** Length of the window in which bets are accepted. */
export const BETTING_WINDOW_MS = ROUND_DURATION_MS - BETTING_LOCK_MS;

/**
 * Colours of a result number:
 *   1,3,7,9 -> green   2,4,6,8 -> red   0 -> red + violet   5 -> green + violet
 */
export function colorsForNumber(n: number): Color[] {
  if (n === 0) return ["red", "violet"];
  if (n === 5) return ["green", "violet"];
  return n % 2 === 1 ? ["green"] : ["red"];
}

/**
 * Payout multiplier in tenths (stake included) for a selection given the result number; 0 = lost.
 *   green/red: 2x (1.5x when the number is also violet, i.e. 5 for green, 0 for red)
 *   violet:    4.5x on 0 or 5
 *   number:    9x on an exact match
 */
export function multiplierTenths(selection: Selection, n: number): number {
  if (selection === "green") return n === 5 ? 15 : n % 2 === 1 ? 20 : 0;
  if (selection === "red") return n === 0 ? 15 : n % 2 === 0 ? 20 : 0;
  if (selection === "violet") return n === 0 || n === 5 ? 45 : 0;
  return Number(selection) === n ? 90 : 0;
}

/** Virtual points returned for a bet (0 if it lost). Amounts are multiples of 10, so this is exact. */
export function payoutFor(selection: Selection, amount: number, n: number): number {
  return Math.floor((amount * multiplierTenths(selection, n)) / 10);
}

/** Headline multiplier shown on buttons. */
export function displayMultiplier(selection: Selection): string {
  if (selection === "violet") return "4.5x";
  if (selection === "green" || selection === "red") return "2x";
  return "9x";
}

export function isGame(v: unknown): v is Game {
  return typeof v === "string" && (GAMES as readonly string[]).includes(v);
}

export function isSelection(v: unknown): v is Selection {
  return typeof v === "string" && (SELECTIONS as readonly string[]).includes(v);
}

export function isBetAmount(v: unknown): v is BetAmount {
  return typeof v === "number" && (BET_AMOUNTS as readonly number[]).includes(v);
}

/**
 * Rounds are aligned to fixed 180s slots of the Unix epoch, so every server
 * instance and every client computes exactly the same schedule.
 */
export function slotAt(nowMs: number): number {
  return Math.floor(nowMs / ROUND_DURATION_MS);
}

export interface RoundTiming {
  slot: number;
  code: string;
  startsAt: number;
  bettingClosesAt: number;
  endsAt: number;
}

export function timingForSlot(slot: number): RoundTiming {
  const startsAt = slot * ROUND_DURATION_MS;
  return {
    slot,
    code: roundCodeForSlot(slot),
    startsAt,
    bettingClosesAt: startsAt + BETTING_WINDOW_MS,
    endsAt: startsAt + ROUND_DURATION_MS,
  };
}

/** Period number, e.g. "20261010123" = UTC date + 3-digit round of the day (001-480). */
export function roundCodeForSlot(slot: number): string {
  const start = new Date(slot * ROUND_DURATION_MS);
  const y = start.getUTCFullYear();
  const m = String(start.getUTCMonth() + 1).padStart(2, "0");
  const d = String(start.getUTCDate()).padStart(2, "0");
  const dayStart = Date.UTC(y, start.getUTCMonth(), start.getUTCDate());
  const n = Math.floor((start.getTime() - dayStart) / ROUND_DURATION_MS) + 1;
  return `${y}${m}${d}${String(n).padStart(3, "0")}`;
}

export type RoundPhase = "betting" | "locked" | "settling";

export function phaseAt(t: { bettingClosesAt: number; endsAt: number }, nowMs: number): RoundPhase {
  if (nowMs < t.bettingClosesAt) return "betting";
  if (nowMs < t.endsAt) return "locked";
  return "settling";
}

// ---- Real-time message shapes (server -> client) ----

export interface PublicRound {
  id: number;
  game: Game;
  code: string;
  status: "open" | "closed" | "settled";
  startsAt: number;
  bettingClosesAt: number;
  endsAt: number;
  commitHash: string;
}

export interface PublicResult {
  roundId: number;
  game: Game;
  code: string;
  number: number;
  price: number;
  settledAt: number;
}

export type ServerMessage =
  | { type: "hello"; serverTime: number; rounds: PublicRound[]; paused: boolean; recent: PublicResult[] }
  | { type: "tick"; serverTime: number; rounds: PublicRound[]; paused: boolean }
  | { type: "round:new"; serverTime: number; round: PublicRound }
  | { type: "round:closed"; serverTime: number; roundId: number; game: Game }
  | { type: "round:result"; serverTime: number; result: PublicResult; serverSeed: string };
