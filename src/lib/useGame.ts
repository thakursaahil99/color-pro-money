"use client";

import { useEffect, useRef, useState } from "react";
import type { Game, PublicResult, PublicRound } from "@shared/game";

export interface GameState {
  /** current round of each game */
  rounds: Partial<Record<Game, PublicRound>>;
  paused: boolean;
  /** games the admin has switched off */
  disabled: Game[];
  recent: PublicResult[];
  /** false while the server cannot be reached */
  connected: boolean;
  /** server time minus local time, in ms */
  offset: number;
  lastResult: PublicResult | null;
  /** increments whenever any round settles, so pages can refetch balances/bets/records */
  settleCount: number;
}

const POLL_MS = 2000;

const byGame = (rounds: PublicRound[]) => Object.fromEntries(rounds.map((r) => [r.game, r])) as Partial<Record<Game, PublicRound>>;

/**
 * Polls the server's game state every couple of seconds (works on serverless hosts such as Vercel).
 * The countdown is always computed from server timestamps plus a measured clock offset,
 * never from the local clock alone.
 */
export function useGame(): GameState {
  const [state, setState] = useState<GameState>({
    rounds: {},
    paused: false,
    disabled: [],
    recent: [],
    connected: false,
    offset: 0,
    lastResult: null,
    settleCount: 0,
  });
  const samples = useRef<number[]>([]);
  const seen = useRef<Set<number> | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (stopped) return;
      if (document.hidden) {
        timer = setTimeout(poll, POLL_MS);
        return;
      }
      const t0 = Date.now();
      try {
        const res = await fetch("/api/game/state", { cache: "no-store" });
        const s = await res.json();
        if (!res.ok) throw new Error("state failed");
        const t1 = Date.now();
        // Half the round trip is the best guess of the one-way delay; the largest recent sample is the most accurate.
        samples.current = [...samples.current.slice(-9), s.serverTime + (t1 - t0) / 2 - t1];
        const offset = Math.max(...samples.current);
        const recent: PublicResult[] = s.recent;
        setState((p) => {
          let lastResult = p.lastResult;
          let settleCount = p.settleCount;
          if (seen.current === null) {
            seen.current = new Set(recent.map((r) => r.roundId)); // first load: nothing counts as "new"
          } else {
            const fresh = recent.filter((r) => !seen.current!.has(r.roundId));
            if (fresh.length) {
              fresh.forEach((r) => seen.current!.add(r.roundId));
              lastResult = fresh.sort((a, b) => b.settledAt - a.settledAt)[0];
              settleCount += 1;
            }
          }
          return { ...p, connected: true, offset, rounds: byGame(s.rounds), paused: s.paused, disabled: s.disabledGames ?? [], recent, lastResult, settleCount };
        });
      } catch {
        setState((p) => (p.connected ? { ...p, connected: false } : p));
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return state;
}

/** Re-renders regularly with the current server-synchronised time. */
export function useServerNow(offset: number, intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), intervalMs);
    return () => clearInterval(id);
  }, [offset, intervalMs]);
  return now;
}
