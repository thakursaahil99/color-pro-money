import crypto from "node:crypto";
import type { Game } from "../../shared/game";

/**
 * Provably-fair result generation (commit-reveal).
 *
 * 1. When a round is created, a 256-bit seed is drawn from the OS CSPRNG
 *    (crypto.randomBytes) and only its SHA-256 hash is published.
 * 2. The result number (0-9) and display "price" are a pure function of
 *    (seed, game, period). They never look at bets, amounts or users, so
 *    outcomes are independent of how anyone played.
 * 3. After settlement the seed is revealed; anyone can recompute the hash and result.
 */
export function newServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSeed(seed: string): string {
  return crypto.createHash("sha256").update(seed).digest("hex");
}

export interface DrawResult {
  number: number;
  /** 5-digit display price whose last digit is the result number. */
  price: number;
}

export function resultFromSeed(seed: string, game: Game, roundCode: string): DrawResult {
  for (let counter = 0; ; counter++) {
    const digest = crypto.createHmac("sha256", seed).update(`${game}:${roundCode}:${counter}`).digest();
    // Rejection sampling keeps 0-9 exactly equally likely (250 = 10 * 25; bytes 250-255 are discarded).
    const idx = digest.findIndex((b) => b < 250);
    if (idx === -1) continue;
    const number = digest[idx] % 10;
    const base = 1000 + (digest.readUInt16BE(idx === 0 ? 1 : 0) % 9000); // 1000-9999
    return { number, price: base * 10 + number };
  }
}
