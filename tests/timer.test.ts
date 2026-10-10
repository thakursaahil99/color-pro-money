import { describe, expect, it } from "vitest";
import {
  BETTING_LOCK_MS,
  BETTING_WINDOW_MS,
  ROUND_DURATION_MS,
  SELECTIONS,
  colorsForNumber,
  multiplierTenths,
  payoutFor,
  phaseAt,
  roundCodeForSlot,
  slotAt,
  timingForSlot,
} from "../shared/game";

describe("timer synchronisation", () => {
  it("every round lasts exactly 180 seconds", () => {
    expect(ROUND_DURATION_MS).toBe(180_000);
    const t = timingForSlot(slotAt(Date.now()));
    expect(t.endsAt - t.startsAt).toBe(180_000);
  });

  it("betting closes before the round ends", () => {
    const t = timingForSlot(12345);
    expect(t.bettingClosesAt).toBeLessThan(t.endsAt);
    expect(t.endsAt - t.bettingClosesAt).toBe(BETTING_LOCK_MS);
    expect(t.bettingClosesAt - t.startsAt).toBe(BETTING_WINDOW_MS);
  });

  it("any two observers at the same instant compute the same round", () => {
    const now = Date.UTC(2026, 9, 10, 12, 1, 7, 345);
    const a = timingForSlot(slotAt(now));
    const b = timingForSlot(slotAt(now));
    expect(a).toEqual(b);
    expect(a.startsAt).toBeLessThanOrEqual(now);
    expect(a.endsAt).toBeGreaterThan(now);
  });

  it("consecutive rounds are contiguous with no gaps or overlaps", () => {
    const s = slotAt(Date.now());
    for (let i = 0; i < 50; i++) {
      expect(timingForSlot(s + i).endsAt).toBe(timingForSlot(s + i + 1).startsAt);
    }
  });

  it("slot boundaries are exact to the millisecond", () => {
    const t = timingForSlot(1000);
    expect(slotAt(t.startsAt)).toBe(1000);
    expect(slotAt(t.endsAt - 1)).toBe(1000);
    expect(slotAt(t.endsAt)).toBe(1001);
  });

  it("phases transition at the exact deadlines", () => {
    const t = timingForSlot(777);
    expect(phaseAt(t, t.startsAt)).toBe("betting");
    expect(phaseAt(t, t.bettingClosesAt - 1)).toBe("betting");
    expect(phaseAt(t, t.bettingClosesAt)).toBe("locked");
    expect(phaseAt(t, t.endsAt - 1)).toBe("locked");
    expect(phaseAt(t, t.endsAt)).toBe("settling");
  });

  it("period numbers are unique across a full day and reset each UTC day", () => {
    const dayStart = Date.UTC(2026, 9, 10);
    const first = slotAt(dayStart);
    const codes = new Set<string>();
    for (let i = 0; i < 480; i++) codes.add(roundCodeForSlot(first + i));
    expect(codes.size).toBe(480);
    expect(roundCodeForSlot(first)).toBe("20261010001");
    expect(roundCodeForSlot(first + 479)).toBe("20261010480");
    expect(roundCodeForSlot(first + 480)).toBe("20261011001");
  });
});

describe("colours and payouts", () => {
  it("maps numbers to colours (0 = red+violet, 5 = green+violet)", () => {
    expect(colorsForNumber(0)).toEqual(["red", "violet"]);
    expect(colorsForNumber(5)).toEqual(["green", "violet"]);
    for (const n of [1, 3, 7, 9]) expect(colorsForNumber(n)).toEqual(["green"]);
    for (const n of [2, 4, 6, 8]) expect(colorsForNumber(n)).toEqual(["red"]);
  });

  it("pays green/red 2x, 1.5x on the shared-violet numbers, violet 4.5x and exact numbers 9x", () => {
    expect(payoutFor("green", 100, 1)).toBe(200);
    expect(payoutFor("green", 100, 5)).toBe(150);
    expect(payoutFor("green", 100, 2)).toBe(0);
    expect(payoutFor("red", 100, 4)).toBe(200);
    expect(payoutFor("red", 100, 0)).toBe(150);
    expect(payoutFor("red", 100, 7)).toBe(0);
    expect(payoutFor("violet", 100, 0)).toBe(450);
    expect(payoutFor("violet", 100, 5)).toBe(450);
    expect(payoutFor("violet", 100, 3)).toBe(0);
    expect(payoutFor("7", 100, 7)).toBe(900);
    expect(payoutFor("7", 100, 8)).toBe(0);
  });

  it("every payout is a whole number of virtual points for every chip", () => {
    for (const sel of SELECTIONS) {
      for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (const amount of [10, 50, 100, 500, 1000]) {
          const p = payoutFor(sel, amount, n);
          expect(Number.isInteger(p)).toBe(true);
          expect((amount * multiplierTenths(sel, n)) % 10).toBe(0);
        }
      }
    }
  });

  it("no bet type returns more than it costs on average (return is 90-95% per bet)", () => {
    for (const sel of SELECTIONS) {
      let total = 0;
      for (let n = 0; n <= 9; n++) total += multiplierTenths(sel, n);
      const expectedReturn = total / 10 / 10; // average multiplier over the ten equally likely numbers
      expect(expectedReturn).toBeGreaterThanOrEqual(0.9);
      expect(expectedReturn).toBeLessThanOrEqual(0.95);
    }
  });
});
