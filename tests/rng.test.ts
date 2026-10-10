import { describe, expect, it } from "vitest";
import { GAMES } from "../shared/game";
import { hashSeed, newServerSeed, resultFromSeed } from "../server/lib/rng";

describe("result generation", () => {
  it("seeds are 256-bit values from the CSPRNG and never repeat", () => {
    const seeds = new Set(Array.from({ length: 2000 }, newServerSeed));
    expect(seeds.size).toBe(2000);
    for (const s of seeds) expect(s).toMatch(/^[0-9a-f]{64}$/);
  });

  it("the result is a deterministic function of the committed seed, game and period only", () => {
    const seed = newServerSeed();
    const first = resultFromSeed(seed, "parity", "20261010001");
    for (let i = 0; i < 20; i++) expect(resultFromSeed(seed, "parity", "20261010001")).toEqual(first);
    expect(first.number).toBeGreaterThanOrEqual(0);
    expect(first.number).toBeLessThanOrEqual(9);
  });

  it("the display price always ends with the result number", () => {
    for (let i = 0; i < 500; i++) {
      const r = resultFromSeed(newServerSeed(), GAMES[i % 4], `p${i}`);
      expect(r.price % 10).toBe(r.number);
      expect(r.price).toBeGreaterThanOrEqual(10000);
      expect(r.price).toBeLessThan(100000);
    }
  });

  it("the published commit hash verifies the revealed seed", () => {
    const seed = newServerSeed();
    const commit = hashSeed(seed);
    expect(hashSeed(seed)).toBe(commit);
    expect(hashSeed(newServerSeed())).not.toBe(commit);
  });

  it("numbers 0-9 are uniformly distributed (chi-square test)", () => {
    const n = 40_000;
    const counts = new Array(10).fill(0);
    for (let i = 0; i < n; i++) counts[resultFromSeed(newServerSeed(), "parity", `r-${i}`).number]++;
    const expected = n / 10;
    const chi = counts.reduce((acc, c) => acc + (c - expected) ** 2 / expected, 0);
    // 9 degrees of freedom: p = 0.001 critical value is 27.88
    expect(chi).toBeLessThan(27.88);
  });
});
